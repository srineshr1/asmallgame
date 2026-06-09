// server.js — Tilt Tiles game server
// Task 4: room creation/joining, lobby player management, host control.
// (Authoritative game loop is added in Task 5.)

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';
import { GameSim } from './gamesim.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

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
  socket.on('room:create', ({ name } = {}, cb) => {
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

    const player = { id: socket.id, name: sanitizeName(name), colorIndex: 0 };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.roomCode = code;

    console.log(`[room] ${code} created by ${player.name}`);
    cb?.({ ok: true, code, youId: socket.id });
    broadcastLobby(room);
  });

  // Join an existing room by code.
  socket.on('room:join', ({ code, name } = {}, cb) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: 'Room not found' });
    if (room.phase !== 'lobby') return cb?.({ ok: false, error: 'Game already started' });
    if (room.players.size >= MAX_PLAYERS) return cb?.({ ok: false, error: 'Room is full' });

    removePlayerEverywhere(socket);

    const player = { id: socket.id, name: sanitizeName(name), colorIndex: lowestFreeColorIndex(room) };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.roomCode = code;

    console.log(`[room] ${player.name} joined ${code}`);
    cb?.({ ok: true, code, youId: socket.id });
    broadcastLobby(room);
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
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log('\n  Tilt Tiles server running!\n');
  console.log(`  Local:   http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  Network: http://${net.address}:${PORT}   <- open this on your phone`);
      }
    }
  }
  console.log('');
});
