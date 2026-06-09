# Hosting Small Games online

The server (`server.js`) runs **both** games — Tilt Tiles and Liar's Bar — from a
single Node process using Socket.io. To let anyone on the internet join, deploy it
to a host that supports **Node.js + persistent WebSocket connections**.

> Serverless platforms like **Vercel** and **Netlify** will *not* work well here —
> Socket.io needs a long-lived server, not per-request functions.

When hosted, set the environment variable **`DISABLE_HTTPS=1`**. The platform
provides real HTTPS on its own domain, so the app runs plain HTTP behind it (and
the self-signed-certificate dance disappears — Tilt Tiles motion sensors work too,
because the public domain is already a secure `https://` context).

---

## Option A — Render (easiest, free tier)

1. Push this folder to a GitHub repo.
2. Go to <https://render.com> → **New → Web Service** → connect the repo.
3. Render auto-detects the included `render.yaml`. If filling it in manually:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Environment variable:** `DISABLE_HTTPS` = `1`
4. Deploy. You get a URL like `https://small-games.onrender.com`.
5. Share that URL. One person picks **Liar's Bar**, taps **Create Game**, and
   gives the 4-letter code to friends, who open the same URL and **Join**.

> Render's free tier sleeps after ~15 min idle, so the first visit after a nap
> takes a few seconds to wake up. Fine for casual play.

## Option B — Railway

1. Push to GitHub. Go to <https://railway.app> → **New Project → Deploy from repo**.
2. Railway detects Node and runs `npm install` / `npm start` automatically.
3. Add a variable: `DISABLE_HTTPS=1`.
4. Under **Settings → Networking**, click **Generate Domain** to get a public URL.

## Option C — Fly.io or any Docker host

A `Dockerfile` is included.

```bash
fly launch          # accept defaults; it detects the Dockerfile
fly deploy
```

`DISABLE_HTTPS=1` is baked into the Dockerfile. Fly gives you an `https://*.fly.dev`
domain. The same image runs on Google Cloud Run, AWS App Runner, or your own VPS.

## Option D — Your own VPS (DigitalOcean / Hetzner / EC2)

```bash
git clone <your-repo> && cd <repo>
npm install
DISABLE_HTTPS=1 PORT=3000 node server.js
```

Put **Caddy** or **Nginx** in front for HTTPS (Caddy auto-provisions a cert):

```
yourdomain.com {
    reverse_proxy localhost:3000
}
```

Use a process manager (`pm2 start server.js`) so it survives reboots.

---

## Just LAN play (no hosting needed)

Run `npm start` with **no** env vars. The server prints a `http://<your-ip>:3000`
link for phones on the same WiFi (and an HTTPS link Tilt Tiles uses for sensors).
This is the original local-network mode and is unchanged.
