// server.js — Tilt Tiles game server
// Task 4: room creation/joining, lobby player management, host control.
// (Authoritative game loop is added in Task 5.)

import express from "express";
import { createServer } from "http";
import { createServer as createHttpsServer } from "https";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import os from "os";
import selfsigned from "selfsigned";
import { GameSim } from "./gamesim.js";
import { createGame as lbCreateGame, addPlayer as lbAddPlayer, removePlayer as lbRemovePlayer, startGame as lbStartGame, playCards as lbPlayCards, callLiar as lbCallLiar, nextRound as lbNextRound, getPlayerView as lbGetPlayerView } from "./liarsbar-game.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);

// Discover this machine's LAN IPv4 addresses.
function lanIPs() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

// HTTPS is only needed for LOCAL LAN play: mobile browsers require a secure
// context to grant Tilt Tiles motion-sensor access, and a self-signed cert is
// the only way to get that on a bare IP. When deployed to a cloud host (Render,
// Railway, Fly, a VPS behind a reverse proxy, etc.) TLS is terminated by the
// platform on a single port, so we skip the self-signed cert entirely.
//   • Local dev  -> HTTP on PORT + HTTPS on PORT+1 (self-signed)   [default]
//   • Cloud host -> HTTP on PORT only (platform adds real HTTPS)   [DISABLE_HTTPS=1]
const ENABLE_HTTPS = !process.env.DISABLE_HTTPS;
let httpsServer = null;

if (ENABLE_HTTPS) {
  try {
    const altNames = [
      { type: 2, value: "localhost" }, // DNS
      { type: 7, ip: "127.0.0.1" }, // IP
      ...lanIPs().map((ip) => ({ type: 7, ip })),
    ];
    const pems = await selfsigned.generate(
      [{ name: "commonName", value: "tilt-tiles.local" }],
      {
        days: 365,
        keySize: 2048,
        algorithm: "sha256",
        extensions: [{ name: "subjectAltName", altNames }],
      },
    );
    httpsServer = createHttpsServer(
      { key: pems.private, cert: pems.cert },
      app,
    );
  } catch (err) {
    console.warn(
      "[https] could not start self-signed HTTPS, continuing HTTP-only:",
      err.message,
    );
    httpsServer = null;
  }
}

// One Socket.io instance serving the HTTP server (and HTTPS too, if enabled).
const io = new Server(httpServer);
if (httpsServer) io.attach(httpsServer);

app.use(express.static(join(__dirname, "public")));
app.use("/cards", express.static(join(__dirname, "liars-bar", "cards-assets", "png")));

// ---------------------------------------------------------------------------
// Room management
// ---------------------------------------------------------------------------
const MAX_PLAYERS = 8;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

/** rooms: code -> Room */
const rooms = new Map();

function makeRoomCode() {
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function lowestFreeColorIndex(room) {
  const used = new Set([...room.players.values()].map((p) => p.colorIndex));
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return 0;
}

function sanitizeName(name) {
  const n = String(name || "")
    .trim()
    .slice(0, 14);
  return n.length ? n : "Player";
}

// Clamp player-supplied physics to sane ranges so nobody can break the sim.
function sanitizePhysics(p) {
  const clamp = (v, lo, hi, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  };
  p = p || {};
  return {
    ACCEL: clamp(p.ACCEL, 3, 40, 38),
    FRICTION: clamp(p.FRICTION, 0.2, 9, 4.2),
    MAX_SPEED: clamp(p.MAX_SPEED, 2, 20, 13),
    BOUNCE: clamp(p.BOUNCE, 0, 0.95, 0.4),
  };
}

function playerList(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    colorIndex: p.colorIndex,
    isHost: p.id === room.hostId,
    ready: room.ready.has(p.id),
  }));
}

function broadcastLobby(room) {
  io.to(room.code).emit("room:players", {
    code: room.code,
    hostId: room.hostId,
    players: playerList(room),
    maxPlayers: MAX_PLAYERS,
    hasPlayed: room.hasPlayed,
  });
}

function removePlayerEverywhere(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;

  room.players.delete(socket.id);
  room.ready.delete(socket.id);
  socket.leave(code);
  socket.data.roomCode = null;

  // If a match is in progress, remove the ball (counts as elimination).
  if (room.game) room.game.removePlayer(socket.id);

  if (room.players.size === 0) {
    rooms.delete(code);
    if (room.game) {
      room.game.stop();
      room.game = null;
    }
    console.log(`[room] ${code} closed (empty)`);
    return;
  }

  // Reassign host if the host left.
  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value;
    console.log(`[room] ${code} host reassigned to ${room.hostId}`);
  }
  broadcastLobby(room);
}

// ---------------------------------------------------------------------------
// Socket wiring
// ---------------------------------------------------------------------------
io.on("connection", (socket) => {
  console.log(`[socket] connected: ${socket.id}`);
  socket.data.roomCode = null;

  // Create a new room and join it as host.
  socket.on("room:create", ({ name, physics } = {}, cb) => {
    // Leave any previous room first.
    removePlayerEverywhere(socket);

    const code = makeRoomCode();
    const room = {
      code,
      hostId: socket.id,
      players: new Map(),
      phase: "lobby",
      game: null,
      ready: new Set(),
      hasPlayed: false,
      solo: false,
    };
    rooms.set(code, room);

    const player = {
      id: socket.id,
      name: sanitizeName(name),
      colorIndex: 0,
      physics: sanitizePhysics(physics),
    };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.roomCode = code;

    console.log(`[room] ${code} created by ${player.name}`);
    cb?.({ ok: true, code, youId: socket.id });
    broadcastLobby(room);
  });

  // Start a casual single-player game immediately (no lobby, survive as long as you can).
  socket.on("solo:start", ({ name, physics } = {}, cb) => {
    removePlayerEverywhere(socket);

    const code = makeRoomCode();
    const room = {
      code,
      hostId: socket.id,
      players: new Map(),
      phase: "playing",
      game: null,
      ready: new Set(),
      hasPlayed: true,
      solo: true,
    };
    rooms.set(code, room);

    const player = {
      id: socket.id,
      name: sanitizeName(name),
      colorIndex: 0,
      physics: sanitizePhysics(physics),
    };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.roomCode = code;

    console.log(`[room] ${code} solo game started by ${player.name}`);
    cb?.({ ok: true, code, youId: socket.id });

    io.to(code).emit("game:start", { players: playerList(room), solo: true });
    room.game = new GameSim(
      room,
      io,
      () => {
        room.game = null;
        room.phase = "lobby";
        room.ready.clear();
        broadcastLobby(room);
      },
      true,
    );
    room.game.start();
  });

  // Join an existing room by code.
  socket.on("room:join", ({ code, name, physics } = {}, cb) => {
    code = String(code || "")
      .toUpperCase()
      .trim();
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "Room not found" });
    if (room.phase !== "lobby")
      return cb?.({ ok: false, error: "Game already started" });
    if (room.players.size >= MAX_PLAYERS)
      return cb?.({ ok: false, error: "Room is full" });

    removePlayerEverywhere(socket);

    const player = {
      id: socket.id,
      name: sanitizeName(name),
      colorIndex: lowestFreeColorIndex(room),
      physics: sanitizePhysics(physics),
    };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.roomCode = code;

    console.log(`[room] ${player.name} joined ${code}`);
    cb?.({ ok: true, code, youId: socket.id });
    broadcastLobby(room);
  });

  // Update this player's control physics (from the settings panel). Applies to
  // the next game, and live to their ball if a match is already running.
  socket.on("room:settings", ({ physics } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    player.physics = sanitizePhysics(physics);
    if (room.game) room.game.setPhysics(socket.id, player.physics);
  });

  // Toggle this player's "ready" state (used for replays on the results screen).
  socket.on("room:ready", (cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.players.has(socket.id)) return cb?.({ ok: false });
    if (room.ready.has(socket.id)) room.ready.delete(socket.id);
    else room.ready.add(socket.id);
    cb?.({ ok: true, ready: room.ready.has(socket.id) });
    broadcastLobby(room);
  });

  // Leave the current room (back to menu).
  socket.on("room:leave", (cb) => {
    removePlayerEverywhere(socket);
    cb?.({ ok: true });
  });

  // Host starts the game.
  socket.on("room:start", (cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb?.({ ok: false, error: "Not in a room" });
    if (room.hostId !== socket.id)
      return cb?.({ ok: false, error: "Only the host can start" });
    if (room.players.size < 1)
      return cb?.({ ok: false, error: "Need at least 1 player" });

    // On replays, require every non-host player to be ready first.
    if (room.hasPlayed && room.players.size > 1) {
      const others = [...room.players.keys()].filter(
        (id) => id !== room.hostId,
      );
      const allReady = others.every((id) => room.ready.has(id));
      if (!allReady)
        return cb?.({
          ok: false,
          error: "Waiting for all players to ready up",
        });
    }

    room.hasPlayed = true;
    room.ready.clear();
    room.phase = "playing";
    // Single-player game: let the player survive multiple rounds.
    const solo = room.players.size === 1;
    console.log(
      `[room] ${room.code} game starting with ${room.players.size} players`,
    );
    cb?.({ ok: true });

    // Tell clients to switch to the game view, then start the authoritative sim.
    io.to(room.code).emit("game:start", {
      players: playerList(room),
      solo,
    });
    room.game = new GameSim(
      room,
      io,
      () => {
        // Game ended — return the room to the lobby so they can play again.
        room.game = null;
        room.phase = "lobby";
        room.ready.clear();
        broadcastLobby(room);
      },
      solo,
    );
    room.game.start();
  });

  // Player input during gameplay (volatile, ~30Hz).
  socket.on("input", ({ ax, ay } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (room && room.game) room.game.setInput(socket.id, ax, ay);
  });

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected: ${socket.id}`);
    removePlayerEverywhere(socket);
  });
});

// ---------------------------------------------------------------------------
// Liar's Bar — Socket.io namespace
// ---------------------------------------------------------------------------
const lbRooms = {};

function lbGenCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return lbRooms[code] ? lbGenCode() : code;
}

function lbBroadcast(roomCode) {
  const game = lbRooms[roomCode];
  if (!game) return;
  for (const p of game.players) {
    lbNsp.to(p.id).emit("state", lbGetPlayerView(game, p.id));
  }
}

const lbNsp = io.of("/liarsbar");
lbNsp.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("create", (name) => {
    const code = lbGenCode();
    lbRooms[code] = lbCreateGame(code);
    lbAddPlayer(lbRooms[code], socket.id, name);
    currentRoom = code;
    lbBroadcast(code);
  });

  socket.on("join", ({ code, name }) => {
    const game = lbRooms[code?.toUpperCase()];
    if (!game) return socket.emit("error", "Room not found");
    if (!lbAddPlayer(game, socket.id, name)) return socket.emit("error", "Room full or game started");
    currentRoom = code.toUpperCase();
    lbBroadcast(currentRoom);
  });

  socket.on("start", () => {
    const game = lbRooms[currentRoom];
    if (!game) return;
    if (game.players[0]?.id !== socket.id) return socket.emit("error", "Only host can start");
    if (!lbStartGame(game)) return socket.emit("error", "Need 2-4 players");
    lbBroadcast(currentRoom);
  });

  socket.on("play", (cardIndices) => {
    const game = lbRooms[currentRoom];
    if (!game) return;
    const result = lbPlayCards(game, socket.id, cardIndices);
    if (!result.ok) return socket.emit("error", "Invalid play");
    lbBroadcast(currentRoom);
  });

  socket.on("callLiar", () => {
    const game = lbRooms[currentRoom];
    if (!game) return;
    const result = lbCallLiar(game, socket.id);
    if (!result.ok) return socket.emit("error", "Can't call liar now");
    lbBroadcast(currentRoom);
    if (!result.gameOver) {
      setTimeout(() => { lbNextRound(game); lbBroadcast(currentRoom); }, 4000);
    }
  });

  socket.on("disconnect", () => {
    if (currentRoom && lbRooms[currentRoom]) {
      const game = lbRooms[currentRoom];
      const p = game.players.find((pl) => pl.id === socket.id);
      if (p) p.alive = false;
      if (game.state === "lobby") lbRemovePlayer(game, socket.id);
      if (game.players.filter((pl) => pl.alive).length <= 1 && game.state === "playing") {
        game.state = "gameOver";
        game.winner = game.players.find((pl) => pl.alive) || null;
      }
      lbBroadcast(currentRoom);
      if (game.players.length === 0) delete lbRooms[currentRoom];
    }
  });
});

// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || PORT + 1;

// Bind to 0.0.0.0 so cloud platforms / other devices can reach us.
httpServer.listen(PORT, "0.0.0.0", () => {
  if (!httpsServer) {
    // Cloud / HTTP-only mode: the platform provides real HTTPS on one port.
    console.log("\n  Small Games server running (HTTP-only / cloud mode).\n");
    console.log(`  Listening on port ${PORT}.`);
    console.log(
      "  Your hosting platform should expose this over its own HTTPS domain.",
    );
    console.log(
      "  Open that public URL and pick a game — anyone with the link can join.",
    );
    console.log("");
    return;
  }

  httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
    const ips = lanIPs();
    console.log("\n  Small Games server running!\n");
    console.log(`  On this computer:   http://localhost:${PORT}`);
    console.log("");
    console.log("  On your PHONE (same WiFi) — open this to pick a game:");
    if (ips.length === 0) console.log("    (no LAN address found)");
    for (const ip of ips) {
      console.log(`    http://${ip}:${PORT}`);
    }
    console.log("");
    console.log(
      "  Liar's Bar works right away over that http:// link (no sensors needed).",
    );
    console.log("");
    console.log(
      "  Tilt Tiles needs motion sensors, so phones must use HTTPS for it:",
    );
    for (const ip of ips) {
      console.log(`    https://${ip}:${HTTPS_PORT}`);
    }
    console.log(
      '  The first time, phones show a "Not secure / certificate" warning —',
    );
    console.log(
      '  that\'s expected for the self-signed cert. Tap Advanced -> "Proceed /',
    );
    console.log(
      "  Visit anyway\" once, then tilt controls will work. (The game-picker",
    );
    console.log("  page links Tilt Tiles to this HTTPS address automatically.)");
    console.log("");
  });
});
