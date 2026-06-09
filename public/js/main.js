// main.js — Tilt Tiles client entry point
// Task 5: server-authoritative play. The server owns tiles/balls/rounds; we render its
// broadcast state and stream our tilt input to it.

import { CONFIG, colorForIndex } from './config.js';
import { Renderer } from './render.js';
import { InputController } from './sensors.js';
import { PHASE } from './rounds.js';
import { NetClient } from './net.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const input = new InputController();
const net = new NetClient();

// --- DOM refs ---
const screens = {
  menu: document.getElementById('menu-screen'),
  lobby: document.getElementById('lobby-screen'),
  over: document.getElementById('over-screen'),
};
const hud = document.getElementById('hud');
const hudLeft = document.getElementById('hud-left');
const hudRight = document.getElementById('hud-right');

const nameInput = document.getElementById('name-input');
const codeInput = document.getElementById('code-input');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const menuHint = document.getElementById('menu-hint');

const roomCodeEl = document.getElementById('room-code');
const playerListEl = document.getElementById('player-list');
const startBtn = document.getElementById('start-btn');
const lobbyWait = document.getElementById('lobby-wait');
const leaveBtn = document.getElementById('leave-btn');

const overTitle = document.getElementById('over-title');
const overSub = document.getElementById('over-sub');
const retryBtn = document.getElementById('retry-btn');

// --- Screen manager ---
function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('hidden', key !== name);
  }
  hud.classList.toggle('hidden', name !== null);
}

// --- Local-player info ---
let myColorIndex = 0;
let isHost = false;
let amAlive = true;

// --- Render state (driven by server 'state' messages) ---
const view = {
  tiles: emptyGrid(),
  balls: [],
  phase: PHASE.IDLE,
};

function emptyGrid() {
  const tiles = [];
  for (let r = 0; r < CONFIG.GRID_ROWS; r++) {
    const row = [];
    for (let c = 0; c < CONFIG.GRID_COLS; c++) row.push({ alive: false, flash: null });
    tiles.push(row);
  }
  return tiles;
}

// Decode the server's compact tile array into the renderer's tile objects.
function decodeTiles(arr) {
  let k = 0;
  for (let r = 0; r < CONFIG.GRID_ROWS; r++) {
    for (let c = 0; c < CONFIG.GRID_COLS; c++) {
      const v = arr[k++];
      const t = view.tiles[r][c];
      t.alive = v !== 0;
      t.flash = v === 2 ? 'safe' : v === 3 ? 'unsafe' : null;
    }
  }
}

const phaseLabels = {
  [PHASE.PREVIEW]: 'Reach a GREEN tile!',
  [PHASE.ELIMINATE]: 'Tiles falling…',
  [PHASE.INTERMISSION]: 'Next round…',
  [PHASE.GAMEOVER]: '',
};

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------
function flashHint(el, msg) {
  el.textContent = msg;
  el.style.color = '#e84a5f';
  setTimeout(() => { el.style.color = ''; }, 2500);
}

async function ensureInput() {
  if (!input.enabled) await input.enableSensors();
}

createBtn.addEventListener('click', async () => {
  createBtn.disabled = true;
  await ensureInput();
  const res = await net.createRoom(nameInput.value);
  createBtn.disabled = false;
  if (!res.ok) return flashHint(menuHint, res.error || 'Could not create room');
  enterLobby();
});

joinBtn.addEventListener('click', async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length < 4) return flashHint(menuHint, 'Enter a 4-letter code');
  joinBtn.disabled = true;
  await ensureInput();
  const res = await net.joinRoom(code, nameInput.value);
  joinBtn.disabled = false;
  if (!res.ok) return flashHint(menuHint, res.error || 'Could not join');
  enterLobby();
});

function enterLobby() {
  roomCodeEl.textContent = net.code;
  showScreen('lobby');
}

leaveBtn.addEventListener('click', async () => {
  await net.leaveRoom();
  showScreen('menu');
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  const res = await net.startGame();
  startBtn.disabled = false;
  if (!res.ok) flashHint(lobbyWait, res.error || 'Could not start');
});

// Lobby player list.
net.on('room:players', ({ players, hostId }) => {
  isHost = hostId === net.youId;
  const me = players.find((p) => p.id === net.youId);
  if (me) myColorIndex = me.colorIndex;

  playerListEl.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = colorForIndex(p.colorIndex);
    li.appendChild(dot);
    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name + (p.id === net.youId ? ' (you)' : '');
    li.appendChild(nameSpan);
    if (p.isHost) {
      const tag = document.createElement('span');
      tag.className = 'host-tag';
      tag.textContent = 'host';
      li.appendChild(tag);
    }
    playerListEl.appendChild(li);
  }
  startBtn.classList.toggle('hidden', !isHost);
  lobbyWait.classList.toggle('hidden', isHost);
});

// Game start — switch to the board.
net.on('game:start', () => {
  amAlive = true;
  input.recalibrate();
  showScreen(null);
});

// Authoritative state from the server.
net.on('state', (s) => {
  view.phase = s.phase;
  decodeTiles(s.tiles);

  view.balls = s.balls.map((b) => ({
    x: b.x,
    y: b.y,
    color: colorForIndex(b.i),
    label: b.id === net.youId ? 'You' : b.n,
    self: b.id === net.youId,
    alive: b.a === 1,
  }));

  const me = s.balls.find((b) => b.id === net.youId);
  if (me) amAlive = me.a === 1;

  // HUD
  hudLeft.textContent = `Round ${s.round}`;
  let right = phaseLabels[s.phase] || '';
  if (s.phase === PHASE.PREVIEW) right = `${phaseLabels[s.phase]}  ${s.timer.toFixed(1)}s`;
  if (!amAlive) right = 'Spectating';
  hudRight.textContent = right;
});

// Someone (maybe you) got eliminated this round.
net.on('game:eliminated', ({ ids }) => {
  if (ids.includes(net.youId) && navigator.vibrate) navigator.vibrate(200);
});

// Game over.
net.on('game:over', ({ winnerId, winnerName, rounds }) => {
  const iWon = winnerId === net.youId;
  overTitle.textContent = iWon ? 'You Win! 🏆' : 'Game Over';
  overSub.textContent = winnerName
    ? `${iWon ? 'You' : winnerName} survived ${rounds} rounds.`
    : `No survivors after ${rounds} rounds.`;
  showScreen('over');
});

retryBtn.addEventListener('click', async () => {
  await net.leaveRoom();
  showScreen('menu');
});

if (!InputController.sensorsSupported()) {
  menuHint.textContent = 'No motion sensor detected — use arrow keys or WASD.';
}

// ---------------------------------------------------------------------------
// Input streaming (~30 Hz) and render loop
// ---------------------------------------------------------------------------
setInterval(() => {
  if (net.code && amAlive) {
    const { ax, ay } = input.get();
    net.sendInput(ax, ay);
  }
}, 1000 / 30);

function frame() {
  renderer.clear();
  renderer.drawTiles(view.tiles);
  renderer.drawBalls(view.balls);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

showScreen('menu');
