// physics.js — Ball movement integration (in tile units)

import { CONFIG } from './config.js';

export const PHYS = {
  ACCEL: 14,        // tiles/sec^2 at full tilt
  FRICTION: 3.2,    // velocity damping per second
  MAX_SPEED: 9,     // tiles/sec
  BOUNCE: 0.4,      // velocity retained when hitting a wall
};

// Integrate a ball given normalized input {ax, ay} over dt seconds.
// ball: { x, y, vx, vy } in tile units. Mutates ball in place.
export function integrate(ball, input, dt) {
  // Apply acceleration from tilt.
  ball.vx += input.ax * PHYS.ACCEL * dt;
  ball.vy += input.ay * PHYS.ACCEL * dt;

  // Friction (exponential damping).
  const damp = Math.exp(-PHYS.FRICTION * dt);
  ball.vx *= damp;
  ball.vy *= damp;

  // Clamp speed.
  const sp = Math.hypot(ball.vx, ball.vy);
  if (sp > PHYS.MAX_SPEED) {
    const k = PHYS.MAX_SPEED / sp;
    ball.vx *= k;
    ball.vy *= k;
  }

  // Integrate position.
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Wall collisions against the outer board bounds.
  const r = CONFIG.BALL_RADIUS;
  const minX = r, maxX = CONFIG.GRID_COLS - r;
  const minY = r, maxY = CONFIG.GRID_ROWS - r;

  if (ball.x < minX) { ball.x = minX; ball.vx = -ball.vx * PHYS.BOUNCE; }
  else if (ball.x > maxX) { ball.x = maxX; ball.vx = -ball.vx * PHYS.BOUNCE; }
  if (ball.y < minY) { ball.y = minY; ball.vy = -ball.vy * PHYS.BOUNCE; }
  else if (ball.y > maxY) { ball.y = maxY; ball.vy = -ball.vy * PHYS.BOUNCE; }
}
