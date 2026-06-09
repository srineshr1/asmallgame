// config.js — shared client-side game constants

export const CONFIG = {
  // Grid dimensions (columns x rows). Portrait-friendly for phones.
  GRID_COLS: 7,
  GRID_ROWS: 9,

  // Visual gap between tiles, as a fraction of a tile's size.
  TILE_GAP: 0.08,

  // Ball radius as a fraction of a tile's size.
  BALL_RADIUS: 0.32,

  // Colors
  COLORS: {
    bg: '#0f1020',
    tile: '#2e3157',
    tileEdge: '#3d4170',
    safe: '#37d67a',     // green flash (preview)
    unsafe: '#e84a5f',   // red flash (preview)
    self: '#ffd166',     // local player's ball
    others: ['#5b8cff', '#ff6b9d', '#9b5bff', '#4ad9d9', '#ff9f43', '#a0e85b', '#ff5b5b'],
  },
};

// Player ball colors assigned by join order (index 0 reserved for "self" tint logic).
export function colorForIndex(i) {
  const pool = CONFIG.COLORS.others;
  return pool[i % pool.length];
}
