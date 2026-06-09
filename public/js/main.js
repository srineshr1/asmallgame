// main.js — Tilt Tiles client entry point
// Task 5: server-authoritative play. The server owns tiles/balls/rounds; we render its
// broadcast state and stream our tilt input to it.

import { CONFIG, colorForIndex } from "./config.js";
import { Renderer } from "./render.js";
import { InputController } from "./sensors.js";
import { PHASE, previewDuration } from "./rounds.js";
import { integrate } from "./physics.js";
import { NetClient } from "./net.js";
import { loadSettings, saveSettings, physicsOf } from "./settings.js";

const canvas = document.getElementById("game");
const renderer = new Renderer(canvas);
const input = new InputController();
const net = new NetClient();

// Per-player control settings (persisted in localStorage). Apply to input now.
const settings = loadSettings();
input.maxTilt = settings.maxTilt;
input.deadZone = settings.deadZone;

// --- DOM refs ---
const screens = {
  menu: document.getElementById("menu-screen"),
  lobby: document.getElementById("lobby-screen"),
  over: document.getElementById("over-screen"),
};
const hud = document.getElementById("hud");
const hudLeft = document.getElementById("hud-left");
const hudRight = document.getElementById("hud-right");
const spectateBanner = document.getElementById("spectate-banner");
const toastEl = document.getElementById("toast");
const timerBar = document.getElementById("timer-bar");
const timerBarFill = document.getElementById("timer-bar-fill");

const nameInput = document.getElementById("name-input");
const codeInput = document.getElementById("code-input");
const createBtn = document.getElementById("create-btn");
const joinBtn = document.getElementById("join-btn");
const menuHint = document.getElementById("menu-hint");

const roomCodeEl = document.getElementById("room-code");
const playerListEl = document.getElementById("player-list");
const startBtn = document.getElementById("start-btn");
const lobbyWait = document.getElementById("lobby-wait");
const leaveBtn = document.getElementById("leave-btn");

const overTitle = document.getElementById("over-title");
const overSub = document.getElementById("over-sub");
const overCrown = document.getElementById("over-crown");
const standingsEl = document.getElementById("standings");
const overReadyBtn = document.getElementById("over-ready-btn");
const overStartBtn = document.getElementById("over-start-btn");
const overReadyStatus = document.getElementById("over-ready-status");
const retryBtn = document.getElementById("retry-btn");

let toastTimer = null;
function showToast(msg, ms = 1400) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  // restart pop animation
  toastEl.style.animation = "none";
  void toastEl.offsetWidth;
  toastEl.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), ms);
}

// --- Screen manager ---
const homeLink = document.getElementById("home-link");
function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle("hidden", key !== name);
  }
  hud.classList.toggle("hidden", name !== null);
  // Show the "Back to Games" link on any menu screen, hide it during gameplay.
  if (homeLink) homeLink.classList.toggle("hidden", name === null);
}

// --- Local-player info ---
let myColorIndex = 0;
let isHost = false;
let amAlive = true;
let myReady = false;
let soloMode = false;
let lastPlayers = [];

// --- Render state (driven by server 'state' messages) ---
const view = {
  tiles: emptyGrid(),
  balls: [], // built each frame from ballsById (interpolated)
  phase: PHASE.IDLE,
};

// Interpolation targets per ball id (smooths 30Hz server -> 60fps render).
const ballsById = new Map();

function emptyGrid() {
  const tiles = [];
  for (let r = 0; r < CONFIG.GRID_ROWS; r++) {
    const row = [];
    for (let c = 0; c < CONFIG.GRID_COLS; c++)
      row.push({ alive: false, flash: null, a: 0 });
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
      t.flash = v === 2 ? "safe" : v === 3 ? "unsafe" : null;
    }
  }
}

const phaseLabels = {
  [PHASE.PREVIEW]: "Reach a GREEN tile!",
  [PHASE.ELIMINATE]: "Tiles falling…",
  [PHASE.INTERMISSION]: "Next round…",
  [PHASE.GAMEOVER]: "",
};

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------
function flashHint(el, msg) {
  el.textContent = msg;
  el.style.color = "#e84a5f";
  setTimeout(() => {
    el.style.color = "";
  }, 2500);
}

async function ensureInput() {
  if (input.enabled) return;
  const res = await input.enableSensors();

  if (res.mode === "sensor") {
    // Confirm data actually starts flowing; if not, the page is likely on
    // insecure HTTP where mobile browsers block the sensor.
    setTimeout(() => {
      if (!input.hasSensorData) {
        flashHint(
          menuHint,
          "Tilt blocked — open the https:// link the server printed.",
        );
      }
    }, 1500);
  } else if (res.reason === "denied") {
    flashHint(
      menuHint,
      "Motion permission denied — using keyboard if available.",
    );
  } else if (res.reason === "no-sensor") {
    // Desktop or unsupported — keyboard fallback already active.
  }
}

createBtn.addEventListener("click", async () => {
  createBtn.disabled = true;
  await ensureInput();
  const res = await net.createRoom(nameInput.value, physicsOf(settings));
  createBtn.disabled = false;
  if (!res.ok) return flashHint(menuHint, res.error || "Could not create room");
  enterLobby();
});

const soloBtn = document.getElementById("solo-btn");
soloBtn.addEventListener("click", async () => {
  soloBtn.disabled = true;
  await ensureInput();
  const res = await net.soloStart(nameInput.value, physicsOf(settings));
  soloBtn.disabled = false;
  if (!res.ok) return flashHint(menuHint, res.error || "Could not start");
  // game:start will switch to the board.
});

joinBtn.addEventListener("click", async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length < 4) return flashHint(menuHint, "Enter a 4-letter code");
  joinBtn.disabled = true;
  await ensureInput();
  const res = await net.joinRoom(code, nameInput.value, physicsOf(settings));
  joinBtn.disabled = false;
  if (!res.ok) return flashHint(menuHint, res.error || "Could not join");
  enterLobby();
});

function enterLobby() {
  soloMode = false;
  roomCodeEl.textContent = net.code;
  showScreen("lobby");
}

leaveBtn.addEventListener("click", () => {
  showScreen("menu");
  net.leaveRoom();
});

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  const res = await net.startGame();
  startBtn.disabled = false;
  if (!res.ok) flashHint(lobbyWait, res.error || "Could not start");
});

// Lobby player list.
net.on("room:players", ({ players, hostId }) => {
  isHost = hostId === net.youId;
  lastPlayers = players;
  const me = players.find((p) => p.id === net.youId);
  if (me) myColorIndex = me.colorIndex;

  playerListEl.innerHTML = "";
  for (const p of players) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = colorForIndex(p.colorIndex);
    li.appendChild(dot);
    const nameSpan = document.createElement("span");
    nameSpan.textContent = p.name + (p.id === net.youId ? " (you)" : "");
    li.appendChild(nameSpan);
    if (p.isHost) {
      const tag = document.createElement("span");
      tag.className = "host-tag";
      tag.textContent = "host";
      li.appendChild(tag);
    }
    playerListEl.appendChild(li);
  }
  startBtn.classList.toggle("hidden", !isHost);
  lobbyWait.classList.toggle("hidden", isHost);

  // Drive the results-screen replay controls from the same player list.
  updateReplayControls(players);
});

// Update the ready/replay UI on the results screen.
function updateReplayControls(players) {
  // Solo: just a Play Again button, no ready system.
  if (soloMode) {
    overReadyBtn.classList.add("hidden");
    overStartBtn.classList.remove("hidden");
    overStartBtn.disabled = false;
    overStartBtn.textContent = "Play Again";
    overReadyStatus.textContent = "";
    return;
  }

  const me = players.find((p) => p.id === net.youId);
  myReady = !!(me && me.ready);
  overReadyBtn.textContent = myReady ? "✔ Ready — tap to cancel" : "Ready to replay";
  overReadyBtn.classList.toggle("ghost", myReady);
  overReadyBtn.classList.toggle("primary", !myReady);

  const others = players.filter((p) => !p.isHost);
  const readyCount = others.filter((p) => p.ready).length;
  const allReady = others.length === 0 || readyCount === others.length;

  if (isHost) {
    overReadyBtn.classList.add("hidden");
    overStartBtn.classList.remove("hidden");
    overStartBtn.disabled = !allReady;
    overStartBtn.textContent = allReady ? "Start Game" : `Start Game (${readyCount}/${others.length} ready)`;
    overReadyStatus.textContent = allReady ? "Everyone's ready!" : "Waiting for players to ready up…";
  } else {
    overStartBtn.classList.add("hidden");
    overReadyBtn.classList.remove("hidden");
    overReadyStatus.textContent = `${readyCount}/${others.length} players ready — waiting for host`;
  }
}

overReadyBtn.addEventListener("click", () => {
  net.toggleReady();
});

overStartBtn.addEventListener("click", async () => {
  overStartBtn.disabled = true;
  const res = await net.startGame();
  if (!res.ok) {
    overStartBtn.disabled = false;
    flashHint(overReadyStatus, res.error || "Could not start");
  }
});

// Game start — switch to the board.
net.on("game:start", ({ solo } = {}) => {
  soloMode = !!solo;
  amAlive = true;
  myReady = false;
  spectateBanner.classList.add("hidden");
  toastEl.classList.add("hidden");
  input.recalibrate();
  showScreen(null);
});

// Authoritative state from the server.
net.on("state", (s) => {
  view.phase = s.phase;
  decodeTiles(s.tiles);

  // Update interpolation targets; create entries for new balls.
  const seen = new Set();
  for (const b of s.balls) {
    seen.add(b.id);
    let e = ballsById.get(b.id);
    if (!e) {
      e = { x: b.x, y: b.y, tx: b.x, ty: b.y, trail: [] };
      ballsById.set(b.id, e);
    }
    e.tx = b.x;
    e.ty = b.y;
    e.color = colorForIndex(b.i);
    e.label = b.id === net.youId ? "You" : b.n;
    e.self = b.id === net.youId;
    e.alive = b.a === 1;
  }
  // Drop balls no longer present.
  for (const id of [...ballsById.keys()])
    if (!seen.has(id)) ballsById.delete(id);

  const me = s.balls.find((b) => b.id === net.youId);
  if (me) amAlive = me.a === 1;

  // Spectate banner only while a multiplayer match is live and you're out.
  const live = s.phase !== PHASE.GAMEOVER;
  spectateBanner.classList.toggle("hidden", soloMode || !(live && !amAlive));

  // HUD + preview progress bar.
  hudLeft.textContent = `Round ${s.round}`;
  let right = phaseLabels[s.phase] || "";
  if (s.phase === PHASE.PREVIEW)
    right = `${phaseLabels[s.phase]}  ${s.timer.toFixed(1)}s`;
  if (!amAlive) right = "Spectating";
  hudRight.textContent = right;

  if (s.phase === PHASE.PREVIEW) {
    const frac = Math.max(
      0,
      Math.min(1, s.timer / Math.max(0.001, previewDuration(s.round))),
    );
    timerBarFill.style.transform = `scaleX(${frac})`;
    timerBar.classList.remove("hidden");
  } else {
    timerBar.classList.add("hidden");
  }
});

// Someone (maybe you) got eliminated this round.
net.on("game:eliminated", ({ ids }) => {
  if (ids.includes(net.youId)) {
    showToast("Eliminated!");
    if (navigator.vibrate) navigator.vibrate(200);
  }
});

// Game over — show the final standings (or solo score).
net.on("game:over", ({ solo, winnerId, winnerName, rounds, roundsSurvived, standings }) => {
  soloMode = !!solo;
  if (solo) {
    overCrown.classList.add("hidden");
    overTitle.textContent = "Game Over";
    overSub.textContent = `You survived ${roundsSurvived} round${roundsSurvived === 1 ? "" : "s"}!`;
    standingsEl.innerHTML = "";
  } else {
    const iWon = winnerId === net.youId;
    overCrown.classList.toggle("hidden", !iWon);
    overTitle.textContent = iWon ? "You Win!" : "Game Over";
    overSub.textContent = winnerName
      ? `${iWon ? "You" : winnerName} won after ${rounds} round${rounds === 1 ? "" : "s"}.`
      : `No survivors after ${rounds} rounds.`;

    // Render leaderboard (multiplayer only).
    standingsEl.innerHTML = "";
    const medals = ["#1", "#2", "#3"];
    for (const p of standings || []) {
      const li = document.createElement("li");
      if (p.rank === 1) li.classList.add("first");
      if (p.id === net.youId) li.classList.add("you");

      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = medals[p.rank - 1] || `#${p.rank}`;
      li.appendChild(rank);

      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = colorForIndex(p.colorIndex);
      li.appendChild(dot);

      const who = document.createElement("span");
      who.className = "who";
      who.textContent = p.name + (p.id === net.youId ? " (you)" : "");
      li.appendChild(who);

      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = p.rank === 1 ? "survived" : `out R${p.roundOut}`;
      li.appendChild(meta);

      standingsEl.appendChild(li);
    }
  }

  spectateBanner.classList.add("hidden");
  // Configure the replay controls immediately so solo never shows the
  // multiplayer "Ready to replay" button (room:players may arrive later or not
  // at all). updateReplayControls handles the solo vs multiplayer split.
  updateReplayControls(lastPlayers);
  showScreen("over");
});

retryBtn.addEventListener("click", () => {
  // Switch screens immediately so the button always responds, even if the
  // socket is slow or dropped; then tell the server we've left.
  showScreen("menu");
  net.leaveRoom();
});

if (!InputController.sensorsSupported()) {
  menuHint.textContent = "No motion sensor detected — use arrow keys or WASD.";
}

// If we're on an insecure HTTP origin on a phone, motion sensors are blocked.
// Offer a one-tap link to the HTTPS version (default HTTPS port = http port + 1).
(function offerSecureLink() {
  const host = location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (window.isSecureContext || isLocal) return;

  const secureLink = document.getElementById("secure-link");
  const httpPort = Number(location.port) || 80;
  const httpsPort = httpPort + 1;
  const url = `https://${host}:${httpsPort}/`;
  secureLink.href = url;
  secureLink.classList.remove("hidden");
  menuHint.textContent =
    "For tilt controls, tap the green button above (secure link).";
})();

// ---------------------------------------------------------------------------
// Control settings / practice mode. Edits persist (localStorage) and sync to
// the server so each player's feel applies in real matches. Client-side physics
// in practice makes changes instant.
// ---------------------------------------------------------------------------
const practice = {
  active: false,
  ball: null,
  tiles: null,
};

const tuneBtn = document.getElementById("tune-btn");
const tunePanel = document.getElementById("tune-panel");
const tuneReadout = document.getElementById("tune-readout");
const tuneDone = document.getElementById("tune-done");
const tuneRecenter = document.getElementById("tune-recenter");
const tuneCopy = document.getElementById("tune-copy");

// Each slider maps to a key on the `settings` object.
const tuners = {
  maxtilt: { key: "maxTilt", fixed: 0, apply: (v) => (input.maxTilt = v) },
  accel: { key: "accel", fixed: 1 },
  friction: { key: "friction", fixed: 1 },
  maxspeed: { key: "maxSpeed", fixed: 1 },
  bounce: { key: "bounce", fixed: 2 },
  deadzone: { key: "deadZone", fixed: 1, apply: (v) => (input.deadZone = v) },
};

function persistAndSync() {
  saveSettings(settings);
  // If connected to a room, push the new physics live.
  if (net.code) net.sendSettings(physicsOf(settings));
}

for (const [id, t] of Object.entries(tuners)) {
  const slider = document.getElementById(`t-${id}`);
  const label = document.getElementById(`v-${id}`);
  slider.value = settings[t.key];
  label.textContent = Number(settings[t.key]).toFixed(t.fixed);
  slider.addEventListener("input", () => {
    const v = parseFloat(slider.value);
    settings[t.key] = v;
    label.textContent = v.toFixed(t.fixed);
    if (t.apply) t.apply(v);
    persistAndSync();
  });
}

function fullGrid() {
  const tiles = [];
  for (let r = 0; r < CONFIG.GRID_ROWS; r++) {
    const row = [];
    for (let c = 0; c < CONFIG.GRID_COLS; c++)
      row.push({ alive: true, flash: null, a: 1 });
    tiles.push(row);
  }
  return tiles;
}

tuneBtn.addEventListener("click", async () => {
  await ensureInput();
  practice.tiles = fullGrid();
  practice.ball = {
    x: CONFIG.GRID_COLS / 2,
    y: CONFIG.GRID_ROWS / 2,
    vx: 0,
    vy: 0,
    color: CONFIG.COLORS.self,
    label: "You",
    self: true,
    alive: true,
    trail: [],
  };
  practice.active = true;
  input.recalibrate();
  showScreen(null);
  hud.classList.add("hidden");
  tunePanel.classList.remove("hidden");
});

tuneDone.addEventListener("click", () => {
  practice.active = false;
  tunePanel.classList.add("hidden");
  showScreen("menu");
});

tuneRecenter.addEventListener("click", () => input.recalibrate());

tuneCopy.addEventListener("click", () => {
  const text =
    `maxTilt=${settings.maxTilt}, deadZone=${settings.deadZone}, ` +
    `ACCEL=${settings.accel}, FRICTION=${settings.friction}, MAX_SPEED=${settings.maxSpeed}, BOUNCE=${settings.bounce}`;
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  showToast("Values copied", 1200);
});

setInterval(() => {
  if (net.code && amAlive) {
    const { ax, ay } = input.get();
    net.sendInput(ax, ay);
  }
}, 1000 / 30);

function frame(now) {
  const dt = Math.min(0.05, (lastFrameTs ? now - lastFrameTs : 16) / 1000);
  lastFrameTs = now;
  renderer.now = now;

  if (practice.active) {
    // Client-side physics so slider changes are felt instantly (uses your settings).
    const phys = physicsOf(settings);
    const steps = 2;
    for (let i = 0; i < steps; i++)
      integrate(practice.ball, input.get(), dt / steps, phys);
    practice.ball.trail.push({ x: practice.ball.x, y: practice.ball.y });
    if (practice.ball.trail.length > 6) practice.ball.trail.shift();

    // Live readout (~throttled by rAF).
    const d = input.debug();
    tuneReadout.textContent =
      `mode:${d.mode}  β:${d.beta.toFixed(0)} γ:${d.gamma.toFixed(0)}  ` +
      `ax:${d.ax.toFixed(2)} ay:${d.ay.toFixed(2)}`;

    renderer.clear();
    renderer.drawTiles(practice.tiles);
    renderer.drawBalls([practice.ball]);
    requestAnimationFrame(frame);
    return;
  }

  // Interpolate ball positions toward server targets, accumulate trails.
  const alpha = 1 - Math.exp(-18 * dt);
  view.balls = [];
  for (const e of ballsById.values()) {
    e.x += (e.tx - e.x) * alpha;
    e.y += (e.ty - e.y) * alpha;
    if (e.alive) {
      e.trail.push({ x: e.x, y: e.y });
      if (e.trail.length > 6) e.trail.shift();
    } else {
      e.trail.length = 0;
    }
    view.balls.push(e);
  }

  // Animate tile scale (fall/grow).
  const tAlpha = 1 - Math.exp(-14 * dt);
  for (let r = 0; r < CONFIG.GRID_ROWS; r++) {
    for (let c = 0; c < CONFIG.GRID_COLS; c++) {
      const t = view.tiles[r][c];
      const target = t.alive ? 1 : 0;
      t.a += (target - t.a) * tAlpha;
    }
  }

  renderer.clear();
  renderer.drawTiles(view.tiles);
  renderer.drawBalls(view.balls);
  requestAnimationFrame(frame);
}
let lastFrameTs = 0;
requestAnimationFrame(frame);

showScreen("menu");
