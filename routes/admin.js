const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const User = require('../models/User');
const Robot = require('../models/Robot');
const Barn = require('../models/Barn');
const FarmMember = require('../models/FarmMember');
const Notification = require('../models/Notification');
const CleaningRun = require('../models/CleaningRun');
const Task = require('../models/Task');
const { requireAdmin, isAdmin, sha256 } = require('../middleware/auth');
const maintenance = require('../lib/maintenance');
const firmware = require('../lib/firmware');
const ErrorLog = require('../models/ErrorLog');
const { deleteUserData } = require('../lib/account');

// ─────────────────────────────────────────────────────────────
// Yönetici paneli: https://<sunucu>/admin
// Sayfa admin/ klasöründeki statik dosyalardır; veriler /admin/api/* uçlarından gelir.
// Giriş: normal AhırBot hesabı + yönetici yetkisi (User.role 'admin' ya da ADMIN_EMAILS).
// ─────────────────────────────────────────────────────────────

const router = express.Router();
const api = express.Router();

const DIR = path.join(__dirname, '..', 'admin');
const FILES = { '/admin': ['index.html', 'text/html'], '/admin/app.js': ['app.js', 'application/javascript'], '/admin/app.css': ['app.css', 'text/css'] };
const ONLINE_MS = 2 * 60 * 1000;
const PAGE = 50;

const security = (res) => res.set({
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
});

// Statik panel dosyaları (veritabanı gerekmez)
Object.entries(FILES).forEach(([url, [file, type]]) => {
  router.get(url, (req, res) => {
    security(res).type(type).send(fs.readFileSync(path.join(DIR, file), 'utf8'));
  });
});
router.get('/admin/', (req, res) => res.redirect(301, '/admin'));

// ─── Yardımcılar ───

const validId = (id) => mongoose.isValidObjectId(id);
const rx = (q) => new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const daysAgo = (d) => new Date(Date.now() - d * 86400000);
const onlineFilter = () => ({ lastSeenAt: { $gte: new Date(Date.now() - ONLINE_MS) } });
const pageOf = (req) => Math.max(0, Number(req.query.page) || 0);

const adminUser = (u) => ({
  id: String(u._id), name: u.name, email: u.email, phone: u.phone || '', role: u.role, admin: isAdmin(u),
  disabled: !!u.disabled, verified: !!u.isEmailVerified, herdSize: u.herdSize || 0,
  createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null,
});

const adminRobot = (r) => {
  const m = maintenance.status(r);
  return {
    id: String(r._id), name: r.name, serialNumber: r.serialNumber, status: r.liveStatus,
    battery: r.battery, tank: r.tank, ammonia: r.ammonia, firmwareVersion: r.firmwareVersion || null,
    lastSeenAt: r.lastSeenAt || null, runHours: Math.round(((r.runMinutes || 0) / 60) * 10) / 10,
    maintenanceDue: m.filter((x) => x.due).map((x) => x.label), pendingCommands: (r.pendingCommands || []).length,
    owner: r.owner && r.owner.email ? { id: String(r.owner._id), name: r.owner.name, email: r.owner.email } : null,
    barn: r.barn && r.barn.name ? (r.barn.fullName || r.barn.name) : '', createdAt: r.createdAt,
    ota: r.ota && r.ota.state ? { state: r.ota.state, version: r.ota.version || null, from: r.ota.from || null, detail: r.ota.detail || null, at: r.ota.at || null } : null,
  };
};

// Gün gün sayım (son N gün): [{ d: '2026-11-17', v: 3 }, …]
const daily = async (Model, field, days, match = {}, sumField) => {
  const rows = await Model.aggregate([
    { $match: { ...match, [field]: { $gte: daysAgo(days) } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: 'Europe/Istanbul' } }, v: sumField ? { $sum: `$${sumField}` } : { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(rows.map((r) => [r._id, r.v]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    return { d, v: Math.round(map[d] || 0) };
  });
};

// ─── Giriş ───
// Aynı sunucu örneğinde 15 dakikada 8 hatalı denemeden sonra e-posta kilitlenir (+ her hatada gecikme)
const fails = new Map();
const LOCK_MS = 15 * 60 * 1000;

api.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ message: 'E-posta ve şifre gerekli.' });

  const f = fails.get(email);
  if (f && f.n >= 8 && Date.now() - f.at < LOCK_MS) return res.status(429).json({ message: 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.' });

  const user = await User.findOne({ email }).select('+password');
  const ok = user && (await bcrypt.compare(password, user.password));
  if (!ok || !isAdmin(user)) {
    fails.set(email, { n: (f && Date.now() - f.at < LOCK_MS ? f.n : 0) + 1, at: Date.now() });
    await new Promise((r) => setTimeout(r, 700));
    if (ok) return res.status(403).json({ message: 'Bu hesabın yönetici yetkisi yok.' });
    return res.status(401).json({ message: 'E-posta veya şifre hatalı.' });
  }
  fails.delete(email);
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  const token = jwt.sign({ id: user._id, adm: true }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, admin: { id: String(user._id), name: user.name, email: user.email } });
});

api.use(requireAdmin);

api.get('/me', (req, res) => res.json({ id: String(req.admin._id), name: req.admin.name, email: req.admin.email }));

// ─── Genel bakış ───
api.get('/stats', async (req, res) => {
  const [users, verified, disabled, admins, newUsers7, robots, online, barns, members, runs7, alarms24, statusRows, fwRows, robotDocs] = await Promise.all([
    User.countDocuments(), User.countDocuments({ isEmailVerified: true }), User.countDocuments({ disabled: true }), User.countDocuments({ role: 'admin' }),
    User.countDocuments({ createdAt: { $gte: daysAgo(7) } }),
    Robot.countDocuments(), Robot.countDocuments(onlineFilter()), Barn.countDocuments(), FarmMember.countDocuments({ status: 'active' }),
    CleaningRun.aggregate([{ $match: { finishedAt: { $gte: daysAgo(7) } } }, { $group: { _id: null, n: { $sum: 1 }, area: { $sum: '$areaM2' }, waste: { $sum: '$wasteKg' } } }]),
    Notification.aggregate([{ $match: { createdAt: { $gte: daysAgo(1) }, code: { $exists: true, $ne: null } } }, { $group: { _id: '$code', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    Robot.aggregate([{ $match: onlineFilter() }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Robot.aggregate([{ $group: { _id: { $ifNull: ['$firmwareVersion', 'bilinmiyor'] }, n: { $sum: 1 } } }, { $sort: { _id: -1 } }]),
    Robot.find().select('runMinutes maintenance').lean(),
  ]);
  const [runsDaily, signupsDaily, errOpen, err24] = await Promise.all([
    daily(CleaningRun, 'finishedAt', 14), daily(User, 'createdAt', 14),
    ErrorLog.countDocuments({ resolved: false }), ErrorLog.countDocuments({ lastAt: { $gte: daysAgo(1) } }),
  ]);
  const due = robotDocs.filter((r) => maintenance.status(r).some((m) => m.due)).length;
  const r7 = runs7[0] || { n: 0, area: 0, waste: 0 };
  const byStatus = Object.fromEntries(statusRows.map((s) => [s._id, s.n]));
  byStatus.offline = robots - online;

  res.json({
    users: { total: users, verified, disabled, admins, new7: newUsers7 },
    robots: { total: robots, online, byStatus, maintenanceDue: due, firmware: fwRows.map((f) => ({ version: f._id, n: f.n })) },
    barns, members,
    runs7: { n: r7.n, areaM2: Math.round(r7.area), wasteKg: Math.round(r7.waste) },
    alarms24: alarms24.map((a) => ({ code: a._id, n: a.n })),
    errors: { open: errOpen, last24: err24 },
    charts: { runs: runsDaily, signups: signupsDaily },
  });
});

// ─── Kullanıcılar ───
api.get('/users', async (req, res) => {
  const filter = {};
  if (req.query.q) filter.$or = [{ name: rx(req.query.q) }, { email: rx(req.query.q) }, { phone: rx(req.query.q) }];
  if (req.query.filter === 'disabled') filter.disabled = true;
  if (req.query.filter === 'admin') filter.role = 'admin';
  if (req.query.filter === 'unverified') filter.isEmailVerified = false;
  const p = pageOf(req);
  const [total, list] = await Promise.all([User.countDocuments(filter), User.find(filter).sort('-createdAt').skip(p * PAGE).limit(PAGE).lean()]);
  const ids = list.map((u) => u._id);
  const [rc, bc, mc] = await Promise.all([
    Robot.aggregate([{ $match: { owner: { $in: ids } } }, { $group: { _id: '$owner', n: { $sum: 1 } } }]),
    Barn.aggregate([{ $match: { owner: { $in: ids } } }, { $group: { _id: '$owner', n: { $sum: 1 } } }]),
    FarmMember.find({ user: { $in: ids }, status: 'active' }).populate('owner', 'name').lean(),
  ]);
  const cnt = (rows) => Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
  const robotsBy = cnt(rc), barnsBy = cnt(bc);
  const memberOf = Object.fromEntries(mc.map((m) => [String(m.user), { owner: m.owner?.name ?? '', role: m.role }]));
  res.json({
    total, page: p, pageSize: PAGE,
    users: list.map((u) => ({ ...adminUser(u), robots: robotsBy[String(u._id)] || 0, barns: barnsBy[String(u._id)] || 0, memberOf: memberOf[String(u._id)] || null })),
  });
});

api.get('/users/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
  const u = await User.findById(req.params.id).lean();
  if (!u) return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
  const [robots, barns, team, membership, notifications, runs30] = await Promise.all([
    Robot.find({ owner: u._id }).populate('barn', 'name fullName'),
    Barn.find({ owner: u._id }).lean(),
    FarmMember.find({ owner: u._id }).populate('user', 'name email').lean(),
    FarmMember.findOne({ user: u._id, status: 'active' }).populate('owner', 'name email').lean(),
    Notification.find({ owner: u._id }).sort('-createdAt').limit(20).populate('robot', 'name').lean(),
    CleaningRun.countDocuments({ owner: u._id, finishedAt: { $gte: daysAgo(30) } }),
  ]);
  res.json({
    user: adminUser(u),
    robots: robots.map(adminRobot),
    barns: barns.map((b) => ({ id: String(b._id), name: b.name, fullName: b.fullName, heads: b.heads })),
    team: team.map((m) => ({ id: String(m._id), email: m.email, name: m.user?.name ?? '', role: m.role, status: m.status })),
    memberOf: membership ? { owner: membership.owner?.name, email: membership.owner?.email, role: membership.role } : null,
    notifications: notifications.map((n) => ({ id: String(n._id), code: n.code || null, type: n.type, title: n.title, body: n.body, robot: n.robot?.name ?? '', createdAt: n.createdAt })),
    runs30,
  });
});

// Askıya al / aç, yönetici yap / al, e-postayı doğrulanmış say
api.patch('/users/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
  const self = String(req.admin._id) === req.params.id;
  const set = {};
  if (typeof req.body.disabled === 'boolean') {
    if (self) return res.status(400).json({ message: 'Kendi hesabınızı askıya alamazsınız.' });
    set.disabled = req.body.disabled;
  }
  if (['user', 'admin'].includes(req.body.role)) {
    if (self) return res.status(400).json({ message: 'Kendi yetkinizi değiştiremezsiniz.' });
    set.role = req.body.role;
  }
  if (req.body.verified === true) set.isEmailVerified = true;
  if (!Object.keys(set).length) return res.status(400).json({ message: 'Değişiklik yok.' });
  const u = await User.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).lean();
  if (!u) return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
  console.log(`ADMIN ${req.admin.email}: kullanıcı ${u.email} → ${JSON.stringify(set)}`);
  res.json(adminUser(u));
});

// Hesabı ve tüm çiftlik verisini sil (kullanıcı e-postayla silme isterse)
api.delete('/users/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
  if (String(req.admin._id) === req.params.id) return res.status(400).json({ message: 'Kendi hesabınızı buradan silemezsiniz.' });
  const info = await deleteUserData(req.params.id);
  if (!info) return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
  console.log(`ADMIN ${req.admin.email}: kullanıcı ${info.email} silindi`);
  res.json({ success: true, deleted: info.summary });
});

// ─── Robotlar ───
api.get('/robots', async (req, res) => {
  const filter = {};
  if (req.query.q) {
    const owners = await User.find({ $or: [{ name: rx(req.query.q) }, { email: rx(req.query.q) }] }).select('_id').lean();
    filter.$or = [{ name: rx(req.query.q) }, { serialNumber: rx(req.query.q) }, { owner: { $in: owners.map((o) => o._id) } }];
  }
  if (req.query.status === 'online') Object.assign(filter, onlineFilter());
  if (req.query.status === 'offline') filter.$and = [{ $or: [{ lastSeenAt: null }, { lastSeenAt: { $lt: new Date(Date.now() - ONLINE_MS) } }] }];
  if (req.query.status === 'problem') Object.assign(filter, onlineFilter(), { status: { $in: ['blocked', 'error'] } });
  if (req.query.firmware) filter.firmwareVersion = req.query.firmware === 'bilinmiyor' ? null : req.query.firmware;
  const p = pageOf(req);
  const [total, list] = await Promise.all([
    Robot.countDocuments(filter),
    Robot.find(filter).sort('-lastSeenAt').skip(p * PAGE).limit(PAGE).populate('owner', 'name email').populate('barn', 'name fullName'),
  ]);
  res.json({ total, page: p, pageSize: PAGE, robots: list.map(adminRobot) });
});

const OTA_RE = /^https?:\/\/\S+$/i;
const ADMIN_COMMANDS = ['stop', 'dock', 'ota'];

// OTA hedefi: panelden yüklenen dosya ({ firmwareId }) ya da harici adres ({ url })
const otaTarget = async (b = {}) => {
  if (b.firmwareId) {
    const fw = await firmware.get(b.firmwareId);
    if (!fw) return { error: 'Yazılım dosyası bulunamadı.' };
    return { payload: firmware.otaPayload(fw), ota: { version: fw.version, firmwareId: fw.id } };
  }
  const url = String(b.url || '').trim();
  if (!OTA_RE.test(url)) return { error: 'Bir yazılım dosyası seçin ya da geçerli bir .bin adresi girin (http/https).' };
  return { payload: { url }, ota: { url } };
};

// Kuyruktaki eski OTA komutu atılır, yenisi eklenir, durum "kuyrukta" olur (tek atomik güncelleme)
const queueOta = (filter, t) => Robot.updateMany(filter, [{
  $set: {
    ota: { state: 'queued', version: t.ota.version || null, firmwareId: t.ota.firmwareId || null, url: t.ota.url || null, from: '$firmwareVersion', detail: null, at: '$$NOW' },
    pendingCommands: { $concatArrays: [
      { $filter: { input: { $ifNull: ['$pendingCommands', []] }, cond: { $ne: ['$$this.command', 'ota'] } } },
      [{ command: 'ota', payload: { $literal: t.payload }, createdAt: '$$NOW' }],
    ] },
  },
}], { updatePipeline: true });

api.post('/robots/:id/command', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Robot bulunamadı.' });
  const { command, payload } = req.body;
  if (!ADMIN_COMMANDS.includes(command)) return res.status(400).json({ message: 'Panelden sadece durdur, şarja gönder ve güncelleme verilebilir.' });
  const robot = await Robot.findById(req.params.id);
  if (!robot) return res.status(404).json({ message: 'Robot bulunamadı.' });
  if (command === 'ota') {
    const t = await otaTarget(payload);
    if (t.error) return res.status(400).json({ message: t.error });
    await queueOta({ _id: robot._id }, t);
    console.log(`ADMIN ${req.admin.email}: ${robot.serialNumber} → ota ${t.ota.version || t.ota.url}`);
    return res.json({ success: true });
  }
  if (command === 'stop') robot.pendingCommands = [];
  robot.pendingCommands.push({ command });
  await robot.save();
  console.log(`ADMIN ${req.admin.email}: ${robot.serialNumber} → ${command}`);
  res.json({ success: true });
});

api.post('/robots/:id/rotate-key', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Robot bulunamadı.' });
  const deviceKey = crypto.randomBytes(24).toString('hex');
  const robot = await Robot.findByIdAndUpdate(req.params.id, { $set: { deviceKeyHash: sha256(deviceKey) } }, { new: true });
  if (!robot) return res.status(404).json({ message: 'Robot bulunamadı.' });
  console.log(`ADMIN ${req.admin.email}: ${robot.serialNumber} anahtarı yenilendi`);
  res.json({ serialNumber: robot.serialNumber, deviceKey });
});

// Robot kaydını sil (satıldı / çalındı): seri numarası boşa çıkar, başka hesap ekleyebilir
api.delete('/robots/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Robot bulunamadı.' });
  const robot = await Robot.findByIdAndDelete(req.params.id);
  if (!robot) return res.status(404).json({ message: 'Robot bulunamadı.' });
  await Task.deleteMany({ robot: robot._id, status: { $in: ['pending', 'running'] } });
  console.log(`ADMIN ${req.admin.email}: ${robot.serialNumber} silindi`);
  res.json({ success: true });
});

// ─── Yazılım dosyaları (OTA) ───
// Yükleme: gövde ham .bin (Content-Type: application/octet-stream), sürüm/not başlıklarda.
api.get('/firmware', async (req, res) => {
  const [files, versions] = await Promise.all([
    firmware.list(),
    Robot.aggregate([{ $group: { _id: { $ifNull: ['$firmwareVersion', 'bilinmiyor'] }, n: { $sum: 1 } } }, { $sort: { _id: -1 } }]),
  ]);
  const onVersion = Object.fromEntries(versions.map((v) => [v._id, v.n]));
  res.json({
    maxBytes: firmware.MAX_BYTES,
    files: files.map((f) => ({ ...f, robots: f.version ? onVersion[f.version] || 0 : 0 })),
    versions: versions.map((v) => ({ version: v._id, n: v.n })),
  });
});

api.post('/firmware', express.raw({ type: () => true, limit: firmware.MAX_BYTES + 1024 }), async (req, res) => {
  const buf = req.body;
  const check = firmware.inspect(buf);
  if (!check.ok) return res.status(400).json({ message: check.reason });
  let version = String(req.get('X-Firmware-Version') || '').trim() || check.version;
  if (!version) return res.status(400).json({ message: 'Dosyada sürüm etiketi yok; sürümü elle yazın (ör. v0.5.0).' });
  if (!firmware.VERSION_RE.test(version)) return res.status(400).json({ message: 'Sürüm sadece harf, rakam, nokta ve tire içerebilir (ör. v0.5.0).' });
  if (check.version && check.version !== version) return res.status(400).json({ message: `Dosyanın içindeki sürüm ${check.version}, siz ${version} yazdınız. Robot güncellemeden sonra ${check.version} bildirir; sürümü düzeltin.` });
  let notes = '';
  let filename = '';
  try { notes = decodeURIComponent(req.get('X-Notes') || '').slice(0, 500); filename = decodeURIComponent(req.get('X-Filename') || '').slice(0, 100); } catch { /* bozuk başlık */ }
  const id = await firmware.save(buf, { version, notes, filename: filename.replace(/[^\w.-]/g, '_') || undefined, uploadedBy: req.admin.email });
  console.log(`ADMIN ${req.admin.email}: yazılım yüklendi ${version} (${buf.length} bayt)`);
  res.status(201).json({ ...(await firmware.get(id)), warning: check.isAhirbot ? null : 'Dosyada AhırBot etiketi bulunamadı. Başka bir projenin .bin dosyası olabilir; göndermeden önce kontrol edin.' });
});

api.delete('/firmware/:id', async (req, res) => {
  if (!(await firmware.remove(req.params.id))) return res.status(404).json({ message: 'Dosya bulunamadı.' });
  console.log(`ADMIN ${req.admin.email}: yazılım silindi ${req.params.id}`);
  res.json({ success: true });
});

// Toplu güncelleme: { firmwareId | url, robotIds | fromVersion | all, onlyOnline, includeSame }
api.post('/ota', async (req, res) => {
  const { robotIds, fromVersion, onlyOnline, includeSame } = req.body;
  const t = await otaTarget(req.body);
  if (t.error) return res.status(400).json({ message: t.error });
  const filter = {};
  if (Array.isArray(robotIds) && robotIds.length) filter._id = { $in: robotIds.filter(validId).map((id) => new mongoose.Types.ObjectId(id)) };
  else if (fromVersion) filter.firmwareVersion = fromVersion === 'bilinmiyor' ? null : fromVersion;
  else if (!req.body.all) return res.status(400).json({ message: 'Robot seçin ya da bir sürüm seçin.' });
  if (onlyOnline) Object.assign(filter, onlineFilter());
  // Zaten bu sürümde olan robotlara gönderme (robot yine de "güncelleme yok" der)
  if (t.ota.version && !includeSame) filter.$and = [...(filter.$and || []), { firmwareVersion: { $ne: t.ota.version } }];
  const r = await queueOta(filter, t);
  console.log(`ADMIN ${req.admin.email}: toplu OTA ${t.ota.version || t.ota.url} → ${r.modifiedCount} robot`);
  res.json({ success: true, count: r.modifiedCount });
});

// Son 14 günün güncelleme durumları
api.get('/ota/status', async (req, res) => {
  const list = await Robot.find({ 'ota.at': { $gte: daysAgo(14) } }).sort({ 'ota.at': -1 }).limit(200).populate('owner', 'name email');
  res.json({ robots: list.map(adminRobot) });
});

// Bekleyen (henüz robota gitmemiş) güncellemeyi iptal et
api.post('/robots/:id/ota-cancel', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Robot bulunamadı.' });
  const r = await Robot.updateOne({ _id: req.params.id, 'ota.state': 'queued' }, { $pull: { pendingCommands: { command: 'ota' } }, $unset: { ota: 1 } });
  if (!r.modifiedCount) return res.status(400).json({ message: 'Robot komutu zaten aldı ya da bekleyen güncelleme yok.' });
  res.json({ success: true });
});

// ─── Uygulama hataları ───
const errorRow = (e) => ({
  id: String(e._id), source: e.source, kind: e.kind, name: e.name, message: e.message, count: e.count, fatalCount: e.fatalCount,
  users: (e.users || []).length, firstAt: e.firstAt, lastAt: e.lastAt, lastAppVersion: e.lastAppVersion || null, lastPlatform: e.lastPlatform || null,
  resolved: !!e.resolved, resolvedAt: e.resolvedAt || null,
});

api.get('/errors', async (req, res) => {
  const filter = {};
  if (req.query.status !== 'all') filter.resolved = req.query.status === 'resolved';
  if (['app', 'server'].includes(req.query.source)) filter.source = req.query.source;
  if (req.query.q) filter.$or = [{ message: rx(req.query.q) }, { name: rx(req.query.q) }, { 'samples.email': rx(req.query.q) }, { lastAppVersion: rx(req.query.q) }];
  if (req.query.days) filter.lastAt = { $gte: daysAgo(Math.max(1, Math.min(365, Number(req.query.days) || 7))) };
  const p = pageOf(req);
  const [total, list] = await Promise.all([
    ErrorLog.countDocuments(filter),
    ErrorLog.find(filter).sort(req.query.sort === 'count' ? '-count' : '-lastAt').skip(p * PAGE).limit(PAGE).select('-samples').lean(),
  ]);
  res.json({ total, page: p, pageSize: PAGE, errors: list.map(errorRow) });
});

api.get('/errors/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Kayıt bulunamadı.' });
  const e = await ErrorLog.findById(req.params.id).lean();
  if (!e) return res.status(404).json({ message: 'Kayıt bulunamadı.' });
  const ids = [...new Set(e.samples.map((x) => x.user && String(x.user)).filter(Boolean))];
  const users = Object.fromEntries((await User.find({ _id: { $in: ids } }).select('name email').lean()).map((u) => [String(u._id), u]));
  res.json({
    ...errorRow(e),
    samples: e.samples.map((x) => ({ ...x, user: x.user && users[String(x.user)] ? { id: String(x.user), name: users[String(x.user)].name, email: users[String(x.user)].email } : null })),
  });
});

api.patch('/errors/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Kayıt bulunamadı.' });
  const resolved = !!req.body.resolved;
  const e = await ErrorLog.findByIdAndUpdate(req.params.id, { $set: { resolved, resolvedAt: resolved ? new Date() : null } }, { new: true }).select('-samples').lean();
  if (!e) return res.status(404).json({ message: 'Kayıt bulunamadı.' });
  res.json(errorRow(e));
});

api.delete('/errors/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Kayıt bulunamadı.' });
  await ErrorLog.deleteOne({ _id: req.params.id });
  res.json({ success: true });
});

// Çözülmüş kayıtları topluca temizle
api.post('/errors/purge-resolved', async (req, res) => {
  const r = await ErrorLog.deleteMany({ resolved: true });
  res.json({ success: true, count: r.deletedCount });
});

// ─── Alarmlar ve turlar ───
api.get('/alarms', async (req, res) => {
  const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
  const filter = { createdAt: { $gte: daysAgo(days) }, $or: [{ code: { $exists: true, $ne: null } }, { type: { $in: ['blocked', 'error'] } }] };
  if (req.query.code) { delete filter.$or; filter.code = String(req.query.code).toUpperCase(); }
  const p = pageOf(req);
  const [total, list] = await Promise.all([
    Notification.countDocuments(filter),
    Notification.find(filter).sort('-createdAt').skip(p * PAGE).limit(PAGE).populate('owner', 'name email').populate('robot', 'name serialNumber').lean(),
  ]);
  res.json({
    total, page: p, pageSize: PAGE,
    alarms: list.map((n) => ({
      id: String(n._id), code: n.code || null, type: n.type, title: n.title, body: n.body, createdAt: n.createdAt,
      owner: n.owner ? { id: String(n.owner._id), name: n.owner.name, email: n.owner.email } : null,
      robot: n.robot ? { id: String(n.robot._id), name: n.robot.name, serialNumber: n.robot.serialNumber } : null,
    })),
  });
});

api.get('/runs', async (req, res) => {
  const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
  const p = pageOf(req);
  const filter = { finishedAt: { $gte: daysAgo(days) } };
  const [total, list] = await Promise.all([
    CleaningRun.countDocuments(filter),
    CleaningRun.find(filter).sort('-finishedAt').skip(p * PAGE).limit(PAGE).populate('owner', 'name').populate('robot', 'name').populate('barn', 'name').lean(),
  ]);
  res.json({
    total, page: p, pageSize: PAGE,
    runs: list.map((r) => ({ id: String(r._id), finishedAt: r.finishedAt, owner: r.owner?.name ?? '', robot: r.robot?.name ?? '', barn: r.barn?.name ?? '', areaM2: r.areaM2, durationMin: r.durationMin, wasteKg: r.wasteKg, ammonia: r.ammonia ?? null })),
  });
});

// pages: veritabanı gerekmez (app.js'te DB bağlantısından önce), api: /admin/api altında
module.exports = { pages: router, api };
