// game.js — Single-player round manager (client-side demo for Task 3).
// In multiplayer (Task 5) the server owns this loop; this lets us play/test solo.

import {
  PHASE, previewDuration, ELIMINATE_DURATION, INTERMISSION_DURATION, REGROW_THRESHOLD,
  makeFullGrid, selectSafeTiles, applyPreviewFlash, eliminateUnsafe,
  aliveTiles, ballOnAliveTile,
} from './rounds.js';

export class RoundManager {
  constructor(state, callbacks = {}) {
    this.state = state;          // { tiles, balls, ... }
    this.cb = callbacks;         // { onPhase(phase, round), onGameOver(rounds), onSurvive(round) }
    this.phase = PHASE.IDLE;
    this.round = 0;
    this.timer = 0;
    this.safeSet = new Set();
  }

  get ball() {
    // The single local player's ball.
    return this.state.balls.find((b) => b.self) || this.state.balls[0];
  }

  start() {
    this.state.tiles = makeFullGrid();
    this.round = 0;
    this._beginPreview();
  }

  _beginPreview() {
    this.round += 1;
    // Regrow the board if it has gotten too small to be playable.
    if (aliveTiles(this.state.tiles).length < REGROW_THRESHOLD) {
      this.state.tiles = makeFullGrid();
    }
    this.safeSet = selectSafeTiles(this.state.tiles, this.round, 1);
    applyPreviewFlash(this.state.tiles, this.safeSet);
    this._setPhase(PHASE.PREVIEW, previewDuration(this.round));
  }

  _setPhase(phase, duration) {
    this.phase = phase;
    this.timer = duration;
    this.cb.onPhase?.(phase, this.round);
  }

  update(dt) {
    if (this.phase === PHASE.IDLE || this.phase === PHASE.GAMEOVER) return;

    this.timer -= dt;
    if (this.timer > 0) return;

    switch (this.phase) {
      case PHASE.PREVIEW: {
        // Tiles vanish now — resolve who's standing safely.
        eliminateUnsafe(this.state.tiles, this.safeSet);
        const survived = ballOnAliveTile(this.ball, this.state.tiles);
        if (!survived) {
          this.ball.alive = false;
        }
        this._setPhase(PHASE.ELIMINATE, ELIMINATE_DURATION);
        break;
      }
      case PHASE.ELIMINATE: {
        if (this.ball.alive === false) {
          this.phase = PHASE.GAMEOVER;
          this.cb.onGameOver?.(this.round);
        } else {
          this.cb.onSurvive?.(this.round);
          this._setPhase(PHASE.INTERMISSION, INTERMISSION_DURATION);
        }
        break;
      }
      case PHASE.INTERMISSION: {
        this._beginPreview();
        break;
      }
    }
  }
}
