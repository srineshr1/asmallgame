// render.js — Canvas rendering for Tilt Tiles
// Resolution-independent: the grid lives in "tile units" and is scaled to fit the canvas.

import { CONFIG } from './config.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    // Layout, computed in resize(): tile size in px + grid origin (top-left) in px.
    this.tile = 0;
    this.originX = 0;
    this.originY = 0;

    this._resize = this.resize.bind(this);
    window.addEventListener('resize', this._resize);
    window.addEventListener('orientationchange', this._resize);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';

    // Fit GRID_COLS x GRID_ROWS into the screen with a little padding.
    const pad = 0.06; // 6% margin around the board
    const availW = w * (1 - pad * 2);
    const availH = h * (1 - pad * 2);
    this.tile = Math.min(availW / CONFIG.GRID_COLS, availH / CONFIG.GRID_ROWS);

    const boardW = this.tile * CONFIG.GRID_COLS;
    const boardH = this.tile * CONFIG.GRID_ROWS;
    this.originX = (w - boardW) / 2;
    this.originY = (h - boardH) / 2;
  }

  // Convert world (tile-unit) coords to screen pixels.
  worldToScreen(wx, wy) {
    return {
      x: (this.originX + wx * this.tile) * this.dpr,
      y: (this.originY + wy * this.tile) * this.dpr,
    };
  }

  clear() {
    const { ctx, canvas } = this;
    ctx.fillStyle = CONFIG.COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // tiles: 2D array [row][col] of tile objects, or null for missing tiles.
  // Each tile: { alive: bool, flash: 'safe'|'unsafe'|null }
  drawTiles(tiles) {
    const { ctx } = this;
    const gap = this.tile * CONFIG.TILE_GAP;
    const size = this.tile - gap;
    const radius = size * 0.16;

    for (let r = 0; r < CONFIG.GRID_ROWS; r++) {
      for (let c = 0; c < CONFIG.GRID_COLS; c++) {
        const t = tiles?.[r]?.[c];
        if (!t || !t.alive) continue;

        const p = this.worldToScreen(c + gap / this.tile / 2, r + gap / this.tile / 2);
        const px = p.x;
        const py = p.y;
        const s = size * this.dpr;

        let fill = CONFIG.COLORS.tile;
        if (t.flash === 'safe') fill = CONFIG.COLORS.safe;
        else if (t.flash === 'unsafe') fill = CONFIG.COLORS.unsafe;

        this._roundRect(px, py, s, s, radius * this.dpr);
        ctx.fillStyle = fill;
        ctx.fill();

        // subtle top edge highlight for depth
        ctx.strokeStyle = CONFIG.COLORS.tileEdge;
        ctx.lineWidth = 1.5 * this.dpr;
        ctx.stroke();
      }
    }
  }

  // balls: array of { x, y, color, label, self, alive }  (x,y in tile units)
  drawBalls(balls) {
    const { ctx } = this;
    const radius = CONFIG.BALL_RADIUS * this.tile * this.dpr;

    for (const b of balls) {
      if (b.alive === false) continue;
      const p = this.worldToScreen(b.x, b.y);

      // shadow
      ctx.beginPath();
      ctx.arc(p.x, p.y + radius * 0.25, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fill();

      // ball
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
      if (b.self) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3 * this.dpr;
        ctx.stroke();
      }

      // glossy highlight
      ctx.beginPath();
      ctx.arc(p.x - radius * 0.3, p.y - radius * 0.3, radius * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();

      // name label
      if (b.label) {
        ctx.font = `${Math.round(13 * this.dpr)}px -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(b.label, p.x, p.y - radius - 4 * this.dpr);
      }
    }
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
