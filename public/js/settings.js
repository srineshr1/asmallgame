// settings.js — per-player control settings, persisted in localStorage.

const KEY = 'tiltTiles.settings.v1';

export const DEFAULT_SETTINGS = {
  maxTilt: 43,
  deadZone: 0,
  accel: 38,
  friction: 4.2,
  maxSpeed: 13,
  bounce: 0.4,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode) — ignore, settings stay in-memory.
  }
}

// The physics shape the server/integrate expects.
export function physicsOf(s) {
  return {
    ACCEL: s.accel,
    FRICTION: s.friction,
    MAX_SPEED: s.maxSpeed,
    BOUNCE: s.bounce,
  };
}
