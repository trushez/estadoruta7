// Carretera Austral — backend
// A small Express server that (1) serves the static app from /public and
// (2) persists community reports and official advisories as JSON files on
// disk under /data, plus saved report photos under /uploads. No external
// database is required — this is intentionally simple so it can run on a
// small Railway service or a Hostinger Node.js/VPS plan with zero extra
// setup beyond `npm install && npm start`.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');
const ADVISORIES_FILE = path.join(DATA_DIR, 'advisories.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

[DATA_DIR, REPORTS_DIR, UPLOADS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});
if (!fs.existsSync(ADVISORIES_FILE)) fs.writeFileSync(ADVISORIES_FILE, '[]');

// Railway/Hostinger sit behind a reverse proxy — this makes req.ip reflect
// the real visitor IP (used only for the lightweight rate limiter below).
app.set('trust proxy', true);

app.use(express.json({ limit: '12mb' }));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // Correct MIME type for the web app manifest (some static servers/CDNs
    // guess "application/octet-stream" for .webmanifest otherwise).
    if (filePath.endsWith('.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
    // Never let the service worker script itself get cached stale — browsers
    // already re-check it periodically, but this avoids CDNs/proxies pinning
    // an old version and blocking updates.
    if (filePath.endsWith(path.sep + 'sw.js') || filePath.endsWith('/sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ---------- helpers ----------
function safeSectorId(id) {
  // Sector ids are always like "sec-puerto-montt-caleta-la-arena". This just
  // blocks path traversal / weird input — it doesn't need to know the exact list.
  return typeof id === 'string' && /^[a-z0-9-]{3,80}$/.test(id) ? id : null;
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}
function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}
function savePhotoIfPresent(report) {
  if (report && typeof report.photo === 'string' && report.photo.startsWith('data:image/')) {
    const match = report.photo.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) { report.photo = null; return report; }
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 6 * 1024 * 1024) { report.photo = null; return report; } // safety cap
    const ext = (match[1] === 'jpeg' ? 'jpg' : match[1]).replace(/[^a-z0-9]/gi, '') || 'jpg';
    const filename = crypto.randomBytes(12).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buf);
    report.photo = '/uploads/' + filename;
  }
  return report;
}

// Very small in-memory rate limiter for write endpoints — one post every 3s
// per IP *per endpoint kind*, so submitting a report doesn't block an advisory
// right after (or vice versa). Resets on restart; this is spam friction, not
// real auth.
const lastPostByKey = new Map();
function rateLimit(kind) {
  return (req, res, next) => {
    const key = kind + ':' + (req.ip || 'unknown');
    const now = Date.now();
    const last = lastPostByKey.get(key) || 0;
    if (now - last < 3000) {
      return res.status(429).json({ error: 'Muy rápido — espera unos segundos e intenta de nuevo.' });
    }
    lastPostByKey.set(key, now);
    next();
  };
}

// ---------- reports ----------
app.get('/api/reports/:sectorId', (req, res) => {
  const id = safeSectorId(req.params.sectorId);
  if (!id) return res.status(400).json({ error: 'invalid sector id' });
  res.json(readJson(path.join(REPORTS_DIR, id + '.json'), []));
});

app.post('/api/reports/:sectorId', rateLimit('report'), (req, res) => {
  const id = safeSectorId(req.params.sectorId);
  if (!id) return res.status(400).json({ error: 'invalid sector id' });
  const report = req.body;
  if (!report || typeof report.text !== 'string' || !report.text.trim()) {
    return res.status(400).json({ error: 'missing text' });
  }
  savePhotoIfPresent(report);
  const file = path.join(REPORTS_DIR, id + '.json');
  const list = readJson(file, []);
  list.unshift(report);
  const capped = list.slice(0, 10);
  writeJsonAtomic(file, capped);
  res.json(capped);
});

app.delete('/api/reports/:sectorId/:reportId', (req, res) => {
  const id = safeSectorId(req.params.sectorId);
  if (!id) return res.status(400).json({ error: 'invalid sector id' });
  const file = path.join(REPORTS_DIR, id + '.json');
  const list = readJson(file, []);
  const toDelete = list.find(r => r.id === req.params.reportId);
  const filtered = list.filter(r => r.id !== req.params.reportId);
  writeJsonAtomic(file, filtered);
  // Best-effort cleanup of the report's uploaded photo, if any.
  if (toDelete && typeof toDelete.photo === 'string' && toDelete.photo.startsWith('/uploads/')) {
    const photoPath = path.join(UPLOADS_DIR, path.basename(toDelete.photo));
    fs.unlink(photoPath, () => {});
  }
  res.json(filtered);
});

// ---------- advisories ----------
app.get('/api/advisories', (req, res) => {
  res.json(readJson(ADVISORIES_FILE, []));
});

app.post('/api/advisories', rateLimit('advisory'), (req, res) => {
  const bulletin = req.body;
  if (!bulletin || !Array.isArray(bulletin.items) || typeof bulletin.rawText !== 'string') {
    return res.status(400).json({ error: 'invalid bulletin' });
  }
  const list = readJson(ADVISORIES_FILE, []);
  list.unshift(bulletin);
  const capped = list.slice(0, 20);
  writeJsonAtomic(ADVISORIES_FILE, capped);
  res.json(capped);
});

app.delete('/api/advisories/:id', (req, res) => {
  const list = readJson(ADVISORIES_FILE, []);
  const filtered = list.filter(b => b.id !== req.params.id);
  writeJsonAtomic(ADVISORIES_FILE, filtered);
  res.json(filtered);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Carretera Austral server listening on port ${PORT}`));
