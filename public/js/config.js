// config.js — shared client-side game constants

export const CONFIG = {
  // Grid dimensions (columns x rows). Portrait-friendly for phones.
  GRID_COLS: 7,
  GRID_ROWS: 9,

  // Visual gap between tiles, as a fraction of a tile's size.
  TILE_GAP: 0.08,

  // Ball radius as a fraction of a tile's size.
  BALL_RADIUS: 0.32,

  // Colors — matched to the UI design system
  COLORS: {
    bg: "#080812", // cosmos — deepest background
    tile: "#2a2d4a", // alive tile body
    tileEdge: "#3d4170", // tile border
    safe: "#34d399", // aurora — green flash (preview)
    unsafe: "#ff5e5b", // flare — red flash (preview)
    self: "#f59e0b", // solar — local player's ball (amber)
    others: [
      "#818cf8", // glacier
      "#ff5e5b", // flare
      "#34d399", // aurora
      "#a78bfa", // violet
      "#f59e0b", // solar
      "#fb7185", // rose
      "#38bdf8", // sky
    ],
  },
};

// Player ball colors assigned by join order (index 0 reserved for "self" tint logic).
export function colorForIndex(i) {
  const pool = CONFIG.COLORS.others;
  return pool[i % pool.length];
}
