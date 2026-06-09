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
  createRoom(name) {
    return this._emit('room:create', { name }).then((res) => {
      if (res.ok) { this.code = res.code; this.youId = res.youId; }
      return res;
    });
  }

  joinRoom(code, name) {
    return this._emit('room:join', { code, name }).then((res) => {
      if (res.ok) { this.code = res.code; this.youId = res.youId; }
      return res;
    });
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
      this.socket.emit(event, payload, (res) => resolve(res || { ok: true }));
    });
  }
}
