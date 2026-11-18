const express = require('express');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const { recordError } = require('../lib/errorLog');

// ─────────────────────────────────────────────────────────────
// POST /client-errors  — uygulama çökünce/hata yakalayınca buraya gönderir.
// Giriş yapılmamış olabilir (ör. açılışta çöktü): token varsa kullanıcı eklenir, yoksa anonim.
// Gövde: { errors: [{ message, name, stack, componentStack, kind, fatal, screen, at }], device: { platform, osVersion, appVersion, buildVersion, model } }
// Kötüye kullanıma karşı: istek başına en çok 10 hata, IP başına dakikada 30 istek.
// ─────────────────────────────────────────────────────────────

const router = express.Router();
const hits = new Map();
const LIMIT = 30;

const rateLimited = (ip) => {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.at > 60000) { hits.set(ip, { at: now, n: 1 }); return false; }
  h.n += 1;
  if (hits.size > 5000) hits.clear();
  return h.n > LIMIT;
};

const optionalUser = async (req) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token || !process.env.JWT_SECRET) return null;
  try {
    const { id } = jwt.verify(token, process.env.JWT_SECRET);
    return await User.findById(id).select('_id email').lean();
  } catch {
    return null;
  }
};

router.post('/client-errors', async (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ message: 'Çok fazla istek.' });
  const list = Array.isArray(req.body?.errors) ? req.body.errors.slice(0, 10) : req.body?.message ? [req.body] : [];
  if (!list.length) return res.status(400).json({ message: 'errors gerekli' });
  const d = req.body.device || {};
  const user = await optionalUser(req);
  const ctx = { source: 'app', user, platform: d.platform, osVersion: d.osVersion, appVersion: d.appVersion, buildVersion: d.buildVersion, model: d.model };
  let saved = 0;
  for (const e of list) {
    if (!e || typeof e !== 'object' || !e.message) continue;
    await recordError(e, ctx);
    saved += 1;
  }
  res.status(201).json({ success: true, saved });
});

module.exports = router;
