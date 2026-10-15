// Página de donaciones para Fernanda y Jose: /ayuda
// Se conecta en server.js con:  require('./ayuda')(app);
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function ayuda(app) {
  const PIN = String(process.env.AYUDA_PIN || '1015');
  if (!process.env.AYUDA_PIN) console.warn('[ayuda] AYUDA_PIN no está definido; usando el PIN por defecto.');

  const dataDir = process.env.AYUDA_DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'ayuda-donaciones.json');
  const CATS = ['ropa-f', 'ropa-j', 'aseo', 'alimentos', 'hogar', 'otro'];

  function seed() {
    return {
      updated: new Date().toISOString(),
      settings: { lugar: 'Oficina de Convivencia de la escuela', horario: '', whatsapp: '', contacto: '', tallaF: '', tallaJ: '' },
      items: JSON.parse(fs.readFileSync(path.join(__dirname, 'ayuda', 'seed-items.json'), 'utf8')),
      log: [],
    };
  }
  let S;
  try { S = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { S = seed(); }
  function persist() {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(S, null, 1));
    fs.renameSync(tmp, file);
  }
  S.pledges = S.pledges || [];
  const pub = () => { const { log, pledges, ...rest } = S; return rest; };
  const now = () => new Date().toISOString();
  function addLog(it, rec, comp, quien) {
    const last = S.log[S.log.length - 1];
    if (last && last.id === it.id && last.quien === quien && Date.now() - Date.parse(last.t) < 600000) {
      last.rec += rec; last.comp += comp; last.t = now();
    } else {
      S.log.push({ t: now(), id: it.id, nombre: it.nombre, rec, comp, quien });
    }
  }
  function save() {
    S.updated = now();
    if (S.log.length > 400) S.log = S.log.slice(-400);
    const open = S.pledges.filter((p) => p.estado === 'pendiente');
    const closed = S.pledges.filter((p) => p.estado !== 'pendiente').slice(-200);
    S.pledges = closed.concat(open).sort((a, b) => a.t.localeCompare(b.t));
    persist();
  }
  // Límite simple para el formulario público: 12 avisos por hora por IP
  const hits = new Map();
  function tooMany(ip) {
    const t = Date.now(), arr = (hits.get(ip) || []).filter((x) => t - x < 3600000);
    arr.push(t); hits.set(ip, arr);
    return arr.length > 12;
  }
  const str = (v, max = 120) => String(v == null ? '' : v).trim().slice(0, max);
  const num = (v, min = 1, max = 9999) => Math.max(min, Math.min(max, parseInt(v, 10) || min));
  const pinOk = (p) => {
    const a = Buffer.from(String(p || '')), b = Buffer.from(PIN);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  app.get('/ayuda', (req, res, next) => {
    if (req.path === '/ayuda') return res.redirect(301, '/ayuda/');
    res.sendFile(path.join(__dirname, 'ayuda', 'index.html'));
  });
  app.get('/api/ayuda', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, state: pub() }); });

  app.post('/api/ayuda/llevo', express.json({ limit: '5kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    const b = req.body || {};
    if (tooMany(req.ip)) return res.status(429).json({ ok: false, error: 'rate' });
    const it = S.items.find((x) => x.id === b.id);
    const nombre = str(b.nombre, 60);
    if (!it) return res.status(404).json({ ok: false, error: 'item' });
    if (nombre.length < 2) return res.status(400).json({ ok: false, error: 'nombre' });
    const falta = Math.max(0, it.necesitado - it.recibido - it.comprometido);
    if (falta < 1) return res.status(409).json({ ok: false, error: 'cubierto', state: pub() });
    const cantidad = Math.min(falta, num(b.cantidad, 1, 50));
    const telefono = String(b.telefono || '').replace(/[^\d+ ]/g, '').trim().slice(0, 20);
    it.comprometido += cantidad;
    S.pledges.push({ pid: 'p' + crypto.randomBytes(5).toString('hex'), t: now(), itemId: it.id, item: it.nombre,
      nombre, cantidad, telefono, estado: 'pendiente' });
    addLog(it, 0, cantidad, nombre + ' (aviso web)');
    try { save(); } catch (e) { console.error('[ayuda] no se pudo guardar', e); return res.status(500).json({ ok: false, error: 'storage' }); }
    res.json({ ok: true, cantidad, state: pub() });
  });

  app.post('/api/ayuda', express.json({ limit: '50kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    const b = req.body || {};
    if (!pinOk(b.pin)) return setTimeout(() => res.status(403).json({ ok: false, error: 'pin' }), 1000);

    const quien = str(b.quien, 60);
    const it = b.id ? S.items.find((x) => x.id === b.id) : null;
    let changed = true;

    switch (b.op) {
      case 'step': {
        if (!it) { changed = false; break; }
        const f = b.field === 'comprometido' ? 'comprometido' : 'recibido';
        const d = Number(b.d) >= 0 ? 1 : -1;
        if (it[f] + d < 0) { changed = false; break; }
        it[f] += d;
        addLog(it, f === 'recibido' ? d : 0, f === 'comprometido' ? d : 0, quien);
        break;
      }
      case 'pledgeDone':
      case 'pledgeCancel': {
        const p = S.pledges.find((x) => x.pid === b.pid && x.estado === 'pendiente');
        if (!p) { changed = false; break; }
        const pi = S.items.find((x) => x.id === p.itemId);
        if (pi) {
          pi.comprometido = Math.max(0, pi.comprometido - p.cantidad);
          if (b.op === 'pledgeDone') pi.recibido += p.cantidad;
          addLog(pi, b.op === 'pledgeDone' ? p.cantidad : 0, -p.cantidad, (quien ? quien + ' · ' : '') + 'de ' + p.nombre);
        }
        p.estado = b.op === 'pledgeDone' ? 'llegó' : 'cancelado';
        p.cerrado = now(); p.por = quien;
        break;
      }
      case 'urg':
        if (it) it.urgente = !it.urgente; else changed = false;
        break;
      case 'edit':
        if (!it) { changed = false; break; }
        if (str(b.nombre)) it.nombre = str(b.nombre);
        it.necesitado = num(b.necesitado);
        if (CATS.includes(b.cat)) it.cat = b.cat;
        it.nota = str(b.nota);
        break;
      case 'del':
        if (it) S.items = S.items.filter((x) => x !== it); else changed = false;
        break;
      case 'add':
        if (!str(b.nombre)) { changed = false; break; }
        S.items.push({
          id: 'i' + crypto.randomBytes(4).toString('hex'), nombre: str(b.nombre),
          cat: CATS.includes(b.cat) ? b.cat : 'otro', necesitado: num(b.necesitado),
          recibido: 0, comprometido: 0, urgente: !!b.urgente, nota: str(b.nota),
        });
        break;
      case 'settings': {
        const s = b.settings || {};
        for (const k of ['lugar', 'horario', 'contacto', 'tallaF', 'tallaJ']) S.settings[k] = str(s[k]);
        S.settings.whatsapp = String(s.whatsapp || '').replace(/\D/g, '').slice(0, 15);
        break;
      }
      default:
        changed = false; // 'load'
    }

    if (changed) {
      try { save(); } catch (e) { console.error('[ayuda] no se pudo guardar', e); return res.status(500).json({ ok: false, error: 'storage' }); }
    }
    res.json({ ok: true, state: S });
  });

  app.use('/ayuda', express.static(path.join(__dirname, 'ayuda'), { index: 'index.html' }));
};
