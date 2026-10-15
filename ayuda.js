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
  const pub = () => { const { log, ...rest } = S; return rest; };
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
        let rec = 0, comp = 0;
        if (f === 'recibido') { rec = d; if (d > 0 && it.comprometido > 0) { it.comprometido--; comp = -1; } }
        else comp = d;
        const last = S.log[S.log.length - 1];
        if (last && last.id === it.id && last.quien === quien && Date.now() - Date.parse(last.t) < 600000) {
          last.rec += rec; last.comp += comp; last.t = new Date().toISOString();
        } else {
          S.log.push({ t: new Date().toISOString(), id: it.id, nombre: it.nombre, rec, comp, quien });
        }
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
      S.updated = new Date().toISOString();
      if (S.log.length > 400) S.log = S.log.slice(-400);
      try { persist(); } catch (e) { console.error('[ayuda] no se pudo guardar', e); return res.status(500).json({ ok: false, error: 'storage' }); }
    }
    res.json({ ok: true, state: S });
  });

  app.use('/ayuda', express.static(path.join(__dirname, 'ayuda'), { index: 'index.html' }));
};
