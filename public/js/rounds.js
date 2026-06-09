// rounds.js — Core round logic (pure, no browser/Node APIs).
// Shared by the client (single-player demo) and the server (authoritative multiplayer).

import { CONFIG } from './config.js';

// Phase names for the round state machine.
export const PHASE = {
  IDLE: 'idle',
  PREVIEW: 'preview',       // safe=green, unsafe=red; players move to safety
  ELIMINATE: 'eliminate',   // unsafe tiles vanish; falling resolved
  INTERMISSION: 'intermission',
  GAMEOVER: 'gameover',
};

// Difficulty curve: fraction of currently-alive tiles that stay safe.
// Starts generous, tightens each round, floored so the board can't vanish instantly.
export function safeFraction(round) {
  return Math.max(0.28, 0.62 - 0.06 * (round - 1));
}

// Preview duration in seconds — shrinks with rounds for rising tension.
export function previewDuration(round) {
  return Math.max(1.4, 3.6 - 0.22 * (round - 1));
}

export const ELIMINATE_DURATION = 0.6;     // seconds tiles take to "fall"
export const INTERMISSION_DURATION = 1.1;   // pause before next preview

// When alive tiles drop below this, regrow the board (a new "stage").
export const REGROW_THRESHOLD = 4;

// Build a full grid of alive tiles.
export function makeFullGrid() {
  const tiles = [];
  for (let r = 0; r < CONFIG.GRID_ROWS; r++) {
    const row = [];
    for (let c = 0; c < CONFIG.GRID_COLS; c++) {
      row.push({ alive: true, flash: null });
    }
    tiles.push(row);
  }
  return tiles;
}

// List of {r, c} for all currently-alive tiles.
export function aliveTiles(tiles) {
  const out = [];
  for (let r = 0; r < CONFIG.GRID_ROWS; r++) {
    for (let c = 0; c < CONFIG.GRID_COLS; c++) {
      if (tiles[r][c] && tiles[r][c].alive) out.push({ r, c });
    }
  }
  return out;
}

// Choose which alive tiles will be safe this round.
// Guarantees at least `minSafe` safe tiles (so survivors always have somewhere to go).
// rng: function returning [0,1). Pass a seeded rng on the server for determinism if desired.
export function selectSafeTiles(tiles, round, minSafe = 1, rng = Math.random) {
  const alive = aliveTiles(tiles);
  if (alive.length === 0) return new Set();

  const frac = safeFraction(round);
  let count = Math.round(alive.length * frac);
  count = Math.max(minSafe, Math.min(alive.length, count));

  // Fisher-Yates shuffle, take first `count`.
  const arr = alive.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const safe = new Set();
  for (let i = 0; i < count; i++) safe.add(`${arr[i].r},${arr[i].c}`);
  return safe;
}

// Apply preview flashes given the chosen safe set.
export function applyPreviewFlash(tiles, safeSet) {
  for (let r = 0; r < CONFIG.GRID_ROWS; r++) {
    for (let c = 0; c < CONFIG.GRID_COLS; c++) {
      const t = tiles[r][c];
      if (!t || !t.alive) continue;
      t.flash = safeSet.has(`${r},${c}`) ? 'safe' : 'unsafe';
    }
  }
}

// Remove unsafe tiles (those not in safeSet). Clears flashes.
export function eliminateUnsafe(tiles, safeSet) {
  for (let r = 0; r < CONFIG.GRID_ROWS; r++) {
    for (let c = 0; c < CONFIG.GRID_COLS; c++) {
      const t = tiles[r][c];
      if (!t || !t.alive) continue;
      if (!safeSet.has(`${r},${c}`)) t.alive = false;
      t.flash = null;
    }
  }
}

// The tile coordinate a ball center sits over.
export function ballTile(ball) {
  return { c: Math.floor(ball.x), r: Math.floor(ball.y) };
}

// Is the ball currently standing on a living tile?
export function ballOnAliveTile(ball, tiles) {
  const { r, c } = ballTile(ball);
  if (r < 0 || r >= CONFIG.GRID_ROWS || c < 0 || c >= CONFIG.GRID_COLS) return false;
  const t = tiles[r][c];
  return !!(t && t.alive);
}
