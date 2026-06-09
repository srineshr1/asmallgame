// physics.js — Ball movement integration (in tile units)

import { CONFIG } from './config.js';

// Default physics. Players can override these per-ball via the settings/tuning panel.
export const PHYS = {
  ACCEL: 38,        // tiles/sec^2 at full tilt
  FRICTION: 4.2,    // velocity damping per second
  MAX_SPEED: 13,    // tiles/sec
  BOUNCE: 0.4,      // velocity retained when hitting a wall
};

// Restitution for ball-to-ball collisions (0 = stick, 1 = perfectly elastic).
export const BALL_RESTITUTION = 0.6;

// Integrate a ball given normalized input {ax, ay} over dt seconds.
// `phys` lets each ball use its own tuned constants (defaults to PHYS).
// ball: { x, y, vx, vy } in tile units. Mutates ball in place.
export function integrate(ball, input, dt, phys = PHYS) {
  const ACCEL = phys.ACCEL ?? PHYS.ACCEL;
  const FRICTION = phys.FRICTION ?? PHYS.FRICTION;
  const MAX_SPEED = phys.MAX_SPEED ?? PHYS.MAX_SPEED;
  const BOUNCE = phys.BOUNCE ?? PHYS.BOUNCE;

  // Apply acceleration from tilt.
  ball.vx += input.ax * ACCEL * dt;
  ball.vy += input.ay * ACCEL * dt;

  // Friction (exponential damping).
  const damp = Math.exp(-FRICTION * dt);
  ball.vx *= damp;
  ball.vy *= damp;

  // Clamp speed.
  const sp = Math.hypot(ball.vx, ball.vy);
  if (sp > MAX_SPEED) {
    const k = MAX_SPEED / sp;
    ball.vx *= k;
    ball.vy *= k;
  }

  // Integrate position.
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  clampToBoard(ball, BOUNCE);
}

// Keep a ball inside the outer board bounds, bouncing off the walls.
export function clampToBoard(ball, bounce = PHYS.BOUNCE) {
  const r = CONFIG.BALL_RADIUS;
  const minX = r, maxX = CONFIG.GRID_COLS - r;
  const minY = r, maxY = CONFIG.GRID_ROWS - r;

  if (ball.x < minX) { ball.x = minX; ball.vx = -ball.vx * bounce; }
  else if (ball.x > maxX) { ball.x = maxX; ball.vx = -ball.vx * bounce; }
  if (ball.y < minY) { ball.y = minY; ball.vy = -ball.vy * bounce; }
  else if (ball.y > maxY) { ball.y = maxY; ball.vy = -ball.vy * bounce; }
}

// Resolve circle-circle collisions between all alive balls (equal mass).
// Mutates positions and velocities in place. `balls` is an array of {x,y,vx,vy,alive}.
export function resolveBallCollisions(balls) {
  const minDist = 2 * CONFIG.BALL_RADIUS;
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (a.alive === false) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (b.alive === false) continue;

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);

      if (dist >= minDist) continue;

      // Identical positions: nudge apart in a deterministic direction.
      if (dist === 0) { dx = 0.01; dy = 0; dist = 0.01; }

      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;

      // Separate the two balls equally along the collision normal.
      a.x -= nx * overlap / 2;
      a.y -= ny * overlap / 2;
      b.x += nx * overlap / 2;
      b.y += ny * overlap / 2;

      // Exchange momentum along the normal (equal mass).
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const imp = -(1 + BALL_RESTITUTION) * vn / 2;
        a.vx -= imp * nx;
        a.vy -= imp * ny;
        b.vx += imp * nx;
        b.vy += imp * ny;
      }
    }
  }

  // Make sure separation didn't push anyone out of bounds.
  for (const ball of balls) {
    if (ball.alive === false) continue;
    clampToBoard(ball, 0);
  }
}
