# Estado de la Carretera Austral

A small Express server (`server.js`) that serves the app (`public/index.html`)
and stores community reports + official advisories as JSON files under
`data/`, with uploaded photos saved to `uploads/`. No external database is
required.

## Run it locally

```
npm install
npm start
```

Then open http://localhost:3000

## Deploy on Railway (recommended — easiest)

1. Push this folder to a GitHub repo (or use the Railway CLI to deploy the
   folder directly with `railway up`).
2. In Railway, "New Project" → "Deploy from GitHub repo" and pick it.
   Railway auto-detects Node.js from `package.json` and runs `npm start`.
3. **Add a Volume** (Railway dashboard → your service → "Volumes" → "New
   Volume") mounted at `/app/data` and another at `/app/uploads`, or a single
   volume mounted at `/app` covering both. Without a volume, every redeploy
   wipes stored reports/advisories, because Railway's filesystem is otherwise
   ephemeral.
4. Railway assigns a public URL automatically (Settings → "Generate Domain").
   Point your own domain at it if you have one (Settings → "Custom Domain").

## Deploy on Hostinger

Hostinger's regular shared/WordPress hosting **cannot** run a Node.js server
— you need either their **Node.js hosting** plan or a **VPS**.

**Node.js hosting plan:**
1. In hPanel, create a new Node.js app, upload this folder (or connect a Git
   repo), set the startup file to `server.js`.
2. Set the Node version to 18 or newer, run `npm install`, then start the app.
3. Confirm the app's working directory is writable and persists between
   restarts — check Hostinger's docs for your specific plan, since this
   varies. If writes don't persist, ask their support how to get a persistent
   folder, or switch to a VPS.

**VPS:** treat it like any Node server — `git clone`, `npm install`, run with
a process manager like `pm2` (`pm2 start server.js --name carretera-austral`)
so it survives reboots and restarts on crash, and put Nginx in front for TLS.

## A few things worth knowing

- **No login/auth.** Anyone can post a report or an advisory, and anyone can
  mark an advisory as expired. That's the point for a community status board,
  but it also means it can be spammed — there's a basic 3-second-per-IP rate
  limit on writes (in `server.js`, search `rateLimit`) but nothing beyond that.
  If abuse becomes a problem, the cleanest next step is adding a lightweight
  moderation step or requiring a name/session before posting.
- **Storage is flat JSON files**, one per sector under `data/reports/`, plus
  `data/advisories.json`. This is intentionally simple and fine for a
  low-traffic regional site. If this ever needs to scale past that, swap the
  `readJson`/`writeJsonAtomic` calls in `server.js` for a real database — the
  API shape (`GET/POST /api/reports/:sectorId`, `GET/POST /api/advisories`,
  `DELETE /api/advisories/:id`) doesn't need to change.
- **Photos** are capped at 6MB decoded and saved under `uploads/`, served
  statically. The client already downsizes photos before upload, so this cap
  is a safety net, not the normal case.
- **Route/weather data** (`LOCATIONS`, `SECTORS` in `public/index.html`) is
  compiled from published route descriptions, not surveyed Vialidad data —
  see the comment above the `LOCATIONS` array if you ever need to adjust it.
