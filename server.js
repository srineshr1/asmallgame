// server.js — Tilt Tiles game server
// Task 4: room creation/joining, lobby player management, host control.
// (Authoritative game loop is added in Task 5.)

import express from 'express';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';
import selfsigned from 'selfsigned';
import { GameSim } from './gamesim.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);

// Discover this machine's LAN IPv4 addresses.
function lanIPs() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

// HTTPS is required by mobile browsers to grant motion-sensor access over the LAN.
// Generate a throwaway self-signed certificate at startup. Use SHA-256 (SHA-1 is
// rejected by modern TLS stacks) and list the LAN IPs as subjectAltNames.
const altNames = [
  { type: 2, value: 'localhost' },          // DNS
  { type: 7, ip: '127.0.0.1' },             // IP
  ...lanIPs().map((ip) => ({ type: 7, ip })),
];
const pems = await selfsigned.generate(
  [{ name: 'commonName', value: 'tilt-tiles.local' }],
  {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  }
);
const httpsServer = createHttpsServer({ key: pems.private, cert: pems.cert }, app);

// One Socket.io instance serving BOTH the HTTP and HTTPS servers.
const io = new Server(httpServer);
io.attach(httpsServer);

app.use(express.static(join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Room management
// ---------------------------------------------------------------------------
const MAX_PLAYERS = 8;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

/** rooms: code -> Room */
const rooms = new Map();

function makeRoomCode() {
  let code;
  do {
    code = '';
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
  const n = String(name || '').trim().slice(0, 14);
  return n.length ? n : 'Player';
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
  }));
}

function broadcastLobby(room) {
  io.to(room.code).emit('room:players', {
    code: room.code,
    hostId: room.hostId,
    players: playerList(room),
    maxPlayers: MAX_PLAYERS,
  });
}

function removePlayerEverywhere(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;

  room.players.delete(socket.id);
  socket.leave(code);
  socket.data.roomCode = null;

  // If a match is in progress, remove the ball (counts as elimination).
  if (room.game) room.game.removePlayer(socket.id);

  if (room.players.size === 0) {
    rooms.delete(code);
    if (room.game) { room.game.stop(); room.game = null; }
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
io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);
  socket.data.roomCode = null;

  // Create a new room and join it as host.
  socket.on('room:create', ({ name, physics } = {}, cb) => {
    // Leave any previous room first.
    removePlayerEverywhere(socket);

    const code = makeRoomCode();
    const room = {
      code,
      hostId: socket.id,
      players: new Map(),
      phase: 'lobby',
      game: null,
    };
    rooms.set(code, room);

    const player = { id: socket.id, name: sanitizeName(name), colorIndex: 0, physics: sanitizePhysics(physics) };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.roomCode = code;

    console.log(`[room] ${code} created by ${player.name}`);
    cb?.({ ok: true, code, youId: socket.id });
    broadcastLobby(room);
  });

  // Join an existing room by code.
  socket.on('room:join', ({ code, name, physics } = {}, cb) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: 'Room not found' });
    if (room.phase !== 'lobby') return cb?.({ ok: false, error: 'Game already started' });
    if (room.players.size >= MAX_PLAYERS) return cb?.({ ok: false, error: 'Room is full' });

    removePlayerEverywhere(socket);

    const player = { id: socket.id, name: sanitizeName(name), colorIndex: lowestFreeColorIndex(room), physics: sanitizePhysics(physics) };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.roomCode = code;

    console.log(`[room] ${player.name} joined ${code}`);
    cb?.({ ok: true, code, youId: socket.id });
    broadcastLobby(room);
  });

  // Update this player's control physics (from the settings panel). Applies to
  // the next game, and live to their ball if a match is already running.
  socket.on('room:settings', ({ physics } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    player.physics = sanitizePhysics(physics);
    if (room.game) room.game.setPhysics(socket.id, player.physics);
  });

  // Leave the current room (back to menu).
  socket.on('room:leave', (cb) => {
    removePlayerEverywhere(socket);
    cb?.({ ok: true });
  });

  // Host starts the game.
  socket.on('room:start', (cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb?.({ ok: false, error: 'Not in a room' });
    if (room.hostId !== socket.id) return cb?.({ ok: false, error: 'Only the host can start' });
    if (room.players.size < 1) return cb?.({ ok: false, error: 'Need at least 1 player' });

    room.phase = 'playing';
    console.log(`[room] ${room.code} game starting with ${room.players.size} players`);
    cb?.({ ok: true });

    // Tell clients to switch to the game view, then start the authoritative sim.
    io.to(room.code).emit('game:start', { players: playerList(room) });
    room.game = new GameSim(room, io, () => {
      // Game ended — return the room to the lobby so they can play again.
      room.game = null;
      room.phase = 'lobby';
      broadcastLobby(room);
    });
    room.game.start();
  });

  // Player input during gameplay (volatile, ~30Hz).
  socket.on('input', ({ ax, ay } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (room && room.game) room.game.setInput(socket.id, ax, ay);
  });

  socket.on('disconnect', () => {
    console.log(`[socket] disconnected: ${socket.id}`);
    removePlayerEverywhere(socket);
  });
});

// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || PORT + 1;

httpServer.listen(PORT, () => {
  httpsServer.listen(HTTPS_PORT, () => {
    const ips = lanIPs();
    console.log('\n  Tilt Tiles server running!\n');
    console.log(`  On this computer:   http://localhost:${PORT}`);
    console.log('');
    console.log('  On your PHONE (same WiFi) — use HTTPS so tilt sensors work:');
    if (ips.length === 0) console.log('    (no LAN address found)');
    for (const ip of ips) {
      console.log(`    https://${ip}:${HTTPS_PORT}`);
    }
    console.log('');
    console.log('  NOTE: phones will show a "Not secure / certificate" warning the first');
    console.log('  time — that\'s expected for the self-signed cert. Tap Advanced ->');
    console.log('  "Proceed / Visit anyway" once, then tilt controls will work.');
    console.log(`  (Plain http://<ip>:${PORT} also works but phone sensors may be blocked.)`);
    console.log('');
  });
});
