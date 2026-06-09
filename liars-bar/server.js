const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createGame, addPlayer, removePlayer, startGame, playCards, callLiar, nextRound, getPlayerView } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/cards', express.static(path.join(__dirname, 'cards-assets', 'png')));

const rooms = {}; // roomCode -> game

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms[code] ? genCode() : code;
}

function broadcastState(roomCode) {
  const game = rooms[roomCode];
  if (!game) return;
  for (const p of game.players) {
    io.to(p.id).emit('state', getPlayerView(game, p.id));
  }
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('create', (name) => {
    const code = genCode();
    rooms[code] = createGame(code);
    addPlayer(rooms[code], socket.id, name);
    currentRoom = code;
    broadcastState(code);
  });

  socket.on('join', ({ code, name }) => {
    const game = rooms[code?.toUpperCase()];
    if (!game) return socket.emit('error', 'Room not found');
    if (!addPlayer(game, socket.id, name)) return socket.emit('error', 'Room full or game started');
    currentRoom = code.toUpperCase();
    broadcastState(currentRoom);
  });

  socket.on('start', () => {
    const game = rooms[currentRoom];
    if (!game) return;
    if (game.players[0]?.id !== socket.id) return socket.emit('error', 'Only host can start');
    if (!startGame(game)) return socket.emit('error', 'Need 2-4 players');
    broadcastState(currentRoom);
  });

  socket.on('play', (cardIndices) => {
    const game = rooms[currentRoom];
    if (!game) return;
    const result = playCards(game, socket.id, cardIndices);
    if (!result.ok) return socket.emit('error', result.reason);
    broadcastState(currentRoom);
  });

  socket.on('callLiar', () => {
    const game = rooms[currentRoom];
    if (!game) return;
    const result = callLiar(game, socket.id);
    if (!result.ok) return socket.emit('error', result.reason);
    broadcastState(currentRoom);
    if (!result.gameOver) {
      setTimeout(() => { nextRound(game); broadcastState(currentRoom); }, 4000);
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      const game = rooms[currentRoom];
      const p = game.players.find(pl => pl.id === socket.id);
      if (p) p.alive = false;
      if (game.state === 'lobby') removePlayer(game, socket.id);
      if (game.players.filter(pl => pl.alive).length <= 1 && game.state === 'playing') {
        game.state = 'gameOver';
        game.winner = game.players.find(pl => pl.alive) || null;
      }
      broadcastState(currentRoom);
      if (game.players.length === 0) delete rooms[currentRoom];
    }
  });
});

const PORT = process.env.PORT || 3099;
server.listen(PORT, () => {
  console.log(`Liar's Bar running at http://localhost:${PORT}`);
});
