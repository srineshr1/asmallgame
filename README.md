# Tilt Tiles

A sensor-based multiplayer tile-survival game. Tilt your phone to roll your ball onto a
**safe (green)** tile before the **unsafe (red)** ones vanish. Survive each round — the
floor shrinks and the preview gets shorter as rounds go on. Last player standing wins.

Up to **8 players** on the same WiFi, served from one host machine.

## Run it

```bash
npm install
npm start
```

The server prints URLs for two purposes:

- `http://localhost:3000` — open on the **host machine** (desktop testing, keyboard controls)
- `https://<your-ip>:3001` — open this on **phones on the same WiFi**

> **Phones must use the `https://` URL.** Mobile browsers only grant motion-sensor
> (gyroscope) access over a secure connection. The server auto-generates a self-signed
> certificate, so the first time you open it the phone shows a *"Not secure / certificate"*
> warning — tap **Advanced → Proceed / Visit anyway** once, and tilt controls will work.

One player taps **Create Game** to get a 4-letter room code; everyone else enters that
code and taps **Join**. The host then taps **Start Game**.

> Custom ports: `PORT=4000 npm start` (HTTPS uses `PORT+1`, or set `HTTPS_PORT`).
> PowerShell: `$env:PORT=4000; node server.js`.

## Controls

- **Phone:** tap "Enable Tilt Controls" (grants the motion sensor), then tilt to move.
- **Desktop:** arrow keys or WASD (handy for testing).

## How it works

- **Server-authoritative.** The server (`gamesim.js`) owns the tile grid, every ball, and
  the round timing. It runs a 30 Hz simulation and broadcasts state to all clients.
- **Clients** send their tilt input (~30 Hz) and render the broadcast state, interpolating
  ball positions to a smooth 60 fps.
- **Shared logic.** Physics (`public/js/physics.js`) and round rules (`public/js/rounds.js`)
  are pure modules imported by *both* the client and the server, so behavior matches.

## Project layout

```
server.js              Express + Socket.io server, room/lobby management
gamesim.js             Authoritative per-room game simulation
public/
  index.html           Screens (menu / lobby / game / results) + canvas
  style.css
  js/
    main.js            Client entry: networking, screens, render loop
    net.js             Socket.io client wrapper
    sensors.js         Device-orientation input + keyboard fallback
    physics.js         Ball movement (shared with server)
    rounds.js          Round/difficulty logic (shared with server)
    render.js          Canvas renderer (tiles, balls, animations)
    config.js          Grid + color constants (shared with server)
```

## Notes

- Motion sensors require **HTTPS** on most browsers, with one exception: `localhost` and
  plain-HTTP LAN addresses work in many mobile browsers. If tilt doesn't activate on a
  phone, the game falls back gracefully, but for guaranteed sensor access serve over HTTPS
  (e.g. via a tunnel) — the game logic is unchanged.
- This server is intended for trusted local-network play; it has no authentication.
