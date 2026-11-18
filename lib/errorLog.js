const crypto = require('crypto');
const ErrorLog = require('../models/ErrorLog');

// ─────────────────────────────────────────────────────────────
// Hata kaydı: uygulamadan gelen (ve sunucuda oluşan) hataları gruplayarak saklar.
// Aynı hata = aynı tür + mesaj (sayılar/kimlikler atılmış) + ilk 3 yığın satırı (dosya:satır atılmış).
// ─────────────────────────────────────────────────────────────

const MAX_SAMPLES = 20;
const MAX_USERS = 200;
const cut = (v, n) => (v == null ? undefined : String(v).slice(0, n));

const normalize = (s = '') => String(s)
  .replace(/https?:\/\/\S+/g, '<url>')
  .replace(/\b[0-9a-f]{24}\b/gi, '<id>')
  .replace(/\d+/g, '#')
  .trim();

const fingerprint = (source, kind, name, message, stack) => {
  const frames = String(stack || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith(String(name || 'Error')))
    .slice(0, 3).map((l) => l.replace(/[:@(]\S*?\d+(:\d+)?\)?$/g, '').replace(/\?[^\s)]*/g, ''));
  return crypto.createHash('sha1').update([source, kind, name, normalize(message), ...frames.map(normalize)].join('|')).digest('hex');
};

/**
 * e: { message, name, stack, componentStack, kind, fatal, screen, extra, at }
 * ctx: { source, user, platform, osVersion, appVersion, buildVersion, model }
 */
const recordError = async (e = {}, ctx = {}) => {
  const message = cut(e.message, 500) || 'Bilinmeyen hata';
  const source = ctx.source === 'server' ? 'server' : 'app';
  const kind = cut(e.kind, 20) || 'error';
  const name = cut(e.name, 60) || 'Error';
  const at = e.at && !Number.isNaN(new Date(e.at).getTime()) && new Date(e.at) < new Date() ? new Date(e.at) : new Date();
  const fatal = !!e.fatal;
  const sample = {
    at, fatal,
    user: ctx.user?._id, email: ctx.user?.email,
    platform: cut(ctx.platform, 20), osVersion: cut(ctx.osVersion, 30), appVersion: cut(ctx.appVersion, 30), buildVersion: cut(ctx.buildVersion, 30), model: cut(ctx.model, 60),
    screen: cut(e.screen, 60), stack: cut(e.stack, 6000), componentStack: cut(e.componentStack, 3000), extra: cut(e.extra, 1000),
  };
  const fp = fingerprint(source, kind, name, message, e.stack);
  const upsert = () => ErrorLog.findOneAndUpdate(
    { fingerprint: fp },
    {
      $setOnInsert: { fingerprint: fp, source, kind, name, message, firstAt: at },
      $set: { lastAt: at, lastAppVersion: sample.appVersion, lastPlatform: sample.platform, resolved: false },  // çözüldü denen hata tekrar ederse yeniden açılır
      $inc: { count: 1, fatalCount: fatal ? 1 : 0 },
      $push: { samples: { $each: [sample], $position: 0, $slice: MAX_SAMPLES } },
    },
    { upsert: true, new: true, projection: { _id: 1 } },
  );
  // Aynı hata aynı anda iki kez gelirse ikinci upsert benzersiz anahtara takılır: bir kez daha denenir
  const doc = await upsert().catch((e) => (e.code === 11000 ? upsert() : Promise.reject(e)));
  if (ctx.user?._id) {
    await ErrorLog.updateOne({ _id: doc._id, [`users.${MAX_USERS - 1}`]: { $exists: false } }, { $addToSet: { users: ctx.user._id } });
  }
  return doc._id;
};

// Sunucu hataları (500): istek bilgisiyle birlikte kaydedilir, hata olursa sessizce geçilir
const recordServerError = (err, req) => recordError(
  { message: err.message, name: err.name, stack: err.stack, kind: 'server', fatal: false, screen: `${req.method} ${req.route?.path || req.path}`.slice(0, 60) },
  { source: 'server', user: req.user, platform: 'server', appVersion: require('../package.json').version },
).catch((e) => console.error('HATA KAYDI YAZILAMADI:', e.message));

module.exports = { recordError, recordServerError, fingerprint };
