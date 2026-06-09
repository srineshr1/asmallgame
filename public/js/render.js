// render.js — Canvas rendering for Tilt Tiles
// Resolution-independent: the grid lives in "tile units" and is scaled to fit the canvas.

import { CONFIG } from './config.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    this.tile = 0;
    this.originX = 0;
    this.originY = 0;
    this.now = 0; // ms, set each frame for animations

    this._resize = this.resize.bind(this);
    window.addEventListener('resize', this._resize);
    window.addEventListener('orientationchange', this._resize);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';

    const pad = 0.06;
    const availW = w * (1 - pad * 2);
    const availH = h * (1 - pad * 2);
    this.tile = Math.min(availW / CONFIG.GRID_COLS, availH / CONFIG.GRID_ROWS);

    const boardW = this.tile * CONFIG.GRID_COLS;
    const boardH = this.tile * CONFIG.GRID_ROWS;
    this.originX = (w - boardW) / 2;
    this.originY = (h - boardH) / 2;
  }

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

  // tiles[r][c]: { alive, flash, a }  where `a` is an animation scale 0..1 (optional).
  drawTiles(tiles) {
    const { ctx } = this;
    const gapPx = this.tile * CONFIG.TILE_GAP;
    const fullSize = this.tile - gapPx;
    const baseRadius = fullSize * 0.16;
    const pulse = 0.5 + 0.5 * Math.sin(this.now / 130); // 0..1 for flash pulsing

    for (let r = 0; r < CONFIG.GRID_ROWS; r++) {
      for (let c = 0; c < CONFIG.GRID_COLS; c++) {
        const t = tiles?.[r]?.[c];
        if (!t) continue;
        const a = t.a != null ? t.a : (t.alive ? 1 : 0);
        if (a <= 0.02) continue;

        // Center of the tile in screen space.
        const center = this.worldToScreen(c + 0.5, r + 0.5);
        const s = fullSize * a * this.dpr;
        const px = center.x - s / 2;
        const py = center.y - s / 2;
        const radius = baseRadius * a * this.dpr;

        let fill = CONFIG.COLORS.tile;
        if (t.alive && t.flash === 'safe') fill = mix(CONFIG.COLORS.safe, '#1f7a45', pulse);
        else if (t.alive && t.flash === 'unsafe') fill = mix(CONFIG.COLORS.unsafe, '#8f2230', pulse);
        else if (!t.alive) fill = '#23254a'; // dying tile, dimmer

        ctx.globalAlpha = Math.min(1, a);
        this._roundRect(px, py, s, s, radius);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = CONFIG.COLORS.tileEdge;
        ctx.lineWidth = 1.5 * this.dpr;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  // balls: array of { x, y, color, label, self, alive, trail }
  drawBalls(balls) {
    const { ctx } = this;
    const radius = CONFIG.BALL_RADIUS * this.tile * this.dpr;

    for (const b of balls) {
      if (b.alive === false) continue;

      // Trail
      if (b.trail && b.trail.length) {
        for (let i = 0; i < b.trail.length; i++) {
          const tp = this.worldToScreen(b.trail[i].x, b.trail[i].y);
          const f = (i + 1) / b.trail.length;
          ctx.globalAlpha = f * 0.25;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, radius * (0.4 + f * 0.5), 0, Math.PI * 2);
          ctx.fillStyle = b.color;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

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
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(b.label, p.x + this.dpr, p.y - radius - 4 * this.dpr + this.dpr);
        ctx.fillStyle = b.self ? '#ffd166' : 'rgba(255,255,255,0.92)';
        ctx.fillText(b.label, p.x, p.y - radius - 4 * this.dpr);
      }
    }
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

// Linear blend between two hex colors, t in 0..1.
function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
