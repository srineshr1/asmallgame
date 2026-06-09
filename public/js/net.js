// net.js — Socket.io client wrapper for Tilt Tiles.
// `io` is provided globally by /socket.io/socket.io.js (loaded in index.html).

export class NetClient {
  constructor() {
    this.socket = io();
    this.youId = null;
    this.code = null;
  }

  get id() {
    return this.socket.id;
  }

  // --- Promise-based room actions ---
  createRoom(name, physics) {
    return this._emit('room:create', { name, physics }).then((res) => {
      if (res.ok) { this.code = res.code; this.youId = res.youId; }
      return res;
    });
  }

  joinRoom(code, name, physics) {
    return this._emit('room:join', { code, name, physics }).then((res) => {
      if (res.ok) { this.code = res.code; this.youId = res.youId; }
      return res;
    });
  }

  // Update control physics (fire-and-forget).
  sendSettings(physics) {
    this.socket.emit('room:settings', { physics });
  }

  leaveRoom() {
    this.code = null;
    return this._emit('room:leave');
  }

  startGame() {
    return this._emit('room:start');
  }

  // --- Event subscription ---
  on(event, handler) {
    this.socket.on(event, handler);
  }

  off(event, handler) {
    this.socket.off(event, handler);
  }

  // Emit input to the server (used in Task 5). Fire-and-forget.
  sendInput(ax, ay) {
    this.socket.volatile.emit('input', { ax, ay });
  }

  _emit(event, payload) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (res) => { if (!done) { done = true; resolve(res); } };
      // Fail open after 4s so the UI never hangs on a dropped connection.
      const timer = setTimeout(() => finish({ ok: false, error: 'No response (connection lost?)' }), 4000);
      this.socket.emit(event, payload, (res) => {
        clearTimeout(timer);
        finish(res || { ok: true });
      });
    });
  }
}
