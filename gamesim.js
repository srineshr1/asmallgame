// gamesim.js — Server-authoritative simulation for one room.
// Owns the tile grid, every player's ball, the round phase machine, and broadcasting.
// Reuses the SAME pure logic the client uses (physics + rounds) so behavior matches.

import { CONFIG } from './public/js/config.js';
import { integrate, resolveBallCollisions } from './public/js/physics.js';
import {
  PHASE, previewDuration, ELIMINATE_DURATION, INTERMISSION_DURATION,
  makeFullGrid, selectSafeTiles, applyPreviewFlash, eliminateUnsafe,
  ballOnAliveTile,
} from './public/js/rounds.js';

const TICK_HZ = 30;
const TICK_MS = 1000 / TICK_HZ;

function clamp(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }

// Spread spawn points in a ring around the board center so balls don't stack.
function spawnPos(idx, n) {
  const cx = CONFIG.GRID_COLS / 2;
  const cy = CONFIG.GRID_ROWS / 2;
  if (n <= 1) return { x: cx, y: cy };
  const radius = Math.min(CONFIG.GRID_COLS, CONFIG.GRID_ROWS) * 0.28;
  const angle = (idx / n) * Math.PI * 2;
  return {
    x: Math.max(0.6, Math.min(CONFIG.GRID_COLS - 0.6, cx + Math.cos(angle) * radius)),
    y: Math.max(0.6, Math.min(CONFIG.GRID_ROWS - 0.6, cy + Math.sin(angle) * radius)),
  };
}

export class GameSim {
  constructor(room, io, onEnd, solo = false) {
    this.room = room;
    this.io = io;
    this.onEnd = onEnd;
    this.solo = solo;

    this.tiles = makeFullGrid();
    this.round = 0;
    this.phase = PHASE.IDLE;
    this.timer = 0;
    this.safeSet = new Set();

    this.balls = new Map();    // playerId -> { id, name, colorIndex, x, y, vx, vy, alive }
    this.inputs = new Map();   // playerId -> { ax, ay }
    this.placements = [];      // elimination order (earliest-out first)

    this.interval = null;
    this.lastTick = 0;
  }

  start() {
    const players = [...this.room.players.values()];
    const n = players.length;
    players.forEach((p, idx) => {
      const pos = spawnPos(idx, n);
      this.balls.set(p.id, {
        id: p.id, name: p.name, colorIndex: p.colorIndex,
        x: pos.x, y: pos.y, vx: 0, vy: 0, alive: true,
        phys: p.physics || undefined,
      });
      this.inputs.set(p.id, { ax: 0, ay: 0 });
    });
    this.round = 0;
    this._beginPreview();
    this.lastTick = Date.now();
    this.interval = setInterval(() => this.tick(), TICK_MS);
  }

  setInput(id, ax, ay) {
    const i = this.inputs.get(id);
    if (i) { i.ax = clamp(+ax || 0); i.ay = clamp(+ay || 0); }
  }

  // Live-update a player's control physics.
  setPhysics(id, phys) {
    const b = this.balls.get(id);
    if (b) b.phys = phys;
  }

  // A player disconnected/left mid-game.
  removePlayer(id) {
    const b = this.balls.get(id);
    if (b && b.alive) {
      b.alive = false;
      this._record(b);
    }
    this.inputs.delete(id);
    this.balls.delete(id);
    this._checkWin();
  }

  // Record a knocked-out player into the standings (earliest-out pushed first).
  _record(ball) {
    this.placements.push({
      id: ball.id,
      name: ball.name,
      colorIndex: ball.colorIndex,
      roundOut: this.round,
    });
  }

  _beginPreview() {
    this.round += 1;
    // The board always refills — removed tiles come back; difficulty rises via
    // fewer safe tiles and shorter previews each round.
    this.tiles = makeFullGrid();
    const aliveBalls = [...this.balls.values()].filter((b) => b.alive).length;
    // Guarantee at least one safe tile per surviving player.
    this.safeSet = selectSafeTiles(this.tiles, this.round, Math.max(1, aliveBalls));
    applyPreviewFlash(this.tiles, this.safeSet);
    this._setPhase(PHASE.PREVIEW, previewDuration(this.round));
  }

  _setPhase(phase, dur) {
    this.phase = phase;
    this.timer = dur;
  }

  tick() {
    const now = Date.now();
    let dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (dt > 0.1) dt = 0.1;

    // Balls move during preview and intermission; frozen while tiles fall.
    if (this.phase === PHASE.PREVIEW || this.phase === PHASE.INTERMISSION) {
      for (const b of this.balls.values()) {
        if (!b.alive) continue;
        integrate(b, this.inputs.get(b.id) || { ax: 0, ay: 0 }, dt, b.phys);
      }
      // Ball-to-ball collisions (server-authoritative).
      resolveBallCollisions([...this.balls.values()]);
    }

    this.timer -= dt;
    if (this.timer <= 0) this._advance();

    this._broadcast();
  }

  _advance() {
    switch (this.phase) {
      case PHASE.PREVIEW: {
        // Tiles vanish — anyone not on a safe tile is out.
        eliminateUnsafe(this.tiles, this.safeSet);
        const justOut = [];
        for (const b of this.balls.values()) {
          if (b.alive && !ballOnAliveTile(b, this.tiles)) {
            b.alive = false;
            this._record(b);
            justOut.push(b.id);
          }
        }
        if (justOut.length) {
          this.io.to(this.room.code).emit('game:eliminated', { ids: justOut });
        }
        this._setPhase(PHASE.ELIMINATE, ELIMINATE_DURATION);
        break;
      }
      case PHASE.ELIMINATE: {
        if (this._checkWin()) return;
        this._setPhase(PHASE.INTERMISSION, INTERMISSION_DURATION);
        break;
      }
      case PHASE.INTERMISSION: {
        this._beginPreview();
        break;
      }
    }
  }

  // Ends the game when too few players remain.
  // Multiplayer: last player standing (<= 1 alive). Solo: only when the player falls.
  _checkWin() {
    const alive = [...this.balls.values()].filter((b) => b.alive);
    const threshold = this.solo ? 0 : 1;
    if (alive.length > threshold) return false;

    const winner = alive[0] || null;
    if (winner) {
      winner.alive = false; // finalize
      this._record(winner);
    }

    // Standings: winner first (last recorded), earliest-out last.
    const standings = [...this.placements].reverse().map((p, idx) => ({
      rank: idx + 1,
      id: p.id,
      name: p.name,
      colorIndex: p.colorIndex,
      roundOut: p.roundOut,
    }));

    this.phase = PHASE.GAMEOVER;
    this._broadcast();
    this.io.to(this.room.code).emit('game:over', {
      solo: this.solo,
      winnerId: winner ? winner.id : null,
      winnerName: winner ? winner.name : null,
      // In solo, the round you fell on; the last fully-survived round is rounds-1.
      rounds: this.round,
      roundsSurvived: Math.max(0, this.round - 1),
      standings,
    });
    this.stop();
    this.onEnd?.();
    return true;
  }

  // Encode tiles compactly: 0=dead, 1=alive, 2=alive+safe-flash, 3=alive+unsafe-flash.
  _encodeTiles() {
    const arr = new Array(CONFIG.GRID_ROWS * CONFIG.GRID_COLS);
    let k = 0;
    for (let r = 0; r < CONFIG.GRID_ROWS; r++) {
      for (let c = 0; c < CONFIG.GRID_COLS; c++) {
        const t = this.tiles[r][c];
        let v = 0;
        if (t && t.alive) v = t.flash === 'safe' ? 2 : t.flash === 'unsafe' ? 3 : 1;
        arr[k++] = v;
      }
    }
    return arr;
  }

  _broadcast() {
    const balls = [...this.balls.values()].map((b) => ({
      id: b.id,
      i: b.colorIndex,
      n: b.name,
      x: +b.x.toFixed(3),
      y: +b.y.toFixed(3),
      a: b.alive ? 1 : 0,
    }));
    this.io.to(this.room.code).emit('state', {
      phase: this.phase,
      round: this.round,
      timer: Math.max(0, +this.timer.toFixed(2)),
      tiles: this._encodeTiles(),
      balls,
    });
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }
}
