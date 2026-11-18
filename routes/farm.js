const express = require('express');
const crypto = require('crypto');

const Barn = require('../models/Barn');
const Robot = require('../models/Robot');
const Task = require('../models/Task');
const Notification = require('../models/Notification');
const CleaningRun = require('../models/CleaningRun');
const User = require('../models/User');
const { requireUser, requireRole, sha256 } = require('../middleware/auth');
const { nowLocal, programSlots, isValidTime } = require('../lib/schedule');

// Uygulamanın kullandığı API'ler (AhırBot src/redux/robotSlice.js ile birebir)
// req.farmId: çiftlik sahibinin id'si (ekip üyesi de sahibin verisini görür), req.farmRole: owner | manager | worker
const router = express.Router();
router.use(requireUser);

const canEdit = requireRole('owner', 'manager');
const ownerOnly = requireRole('owner');

const ago = (date) => {
  const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'şimdi';
  if (s < 3600) return `${Math.floor(s / 60)} dk`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa`;
  return `${Math.floor(s / 86400)} gün`;
};

const validId = (id) => /^[a-f0-9]{24}$/i.test(String(id));

// ───────── Ahırlar ─────────

router.get('/barns', async (req, res) => {
  const barns = await Barn.find({ owner: req.farmId }).sort('createdAt');
  res.json(barns);
});

const clamp01 = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);

// Plan düzenleyiciden gelen düzeni doğrular
const applyLayout = (barn, l) => {
  if (!l || typeof l !== 'object') return;
  const cur = barn.layoutToApp();
  barn.layout = {
    corridors: Math.max(1, Math.min(4, Math.round(Number(l.corridors ?? cur.corridors)) || cur.corridors)),
    stalls: Math.max(2, Math.min(20, Math.round(Number(l.stalls ?? cur.stalls)) || cur.stalls)),
    dock: { x: clamp01(l.dock?.x, cur.dock.x), y: clamp01(l.dock?.y, cur.dock.y) },
    dump: { x: clamp01(l.dump?.x, cur.dump.x), y: clamp01(l.dump?.y, cur.dump.y) },
  };
};

router.post('/barns', canEdit, async (req, res) => {
  const { name, fullName, heads, layout } = req.body;
  if (!name) return res.status(400).json({ message: 'Ahır adı gerekli.' });
  const barn = new Barn({ owner: req.farmId, name, fullName, heads: Number(heads) || 0 });
  applyLayout(barn, layout);
  await barn.save();
  res.status(201).json(barn);
});

router.put('/barns/:id', canEdit, async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Ahır bulunamadı.' });
  const barn = await Barn.findOne({ _id: req.params.id, owner: req.farmId });
  if (!barn) return res.status(404).json({ message: 'Ahır bulunamadı.' });
  const { name, fullName, heads, layout } = req.body;
  if (name !== undefined) { if (!String(name).trim()) return res.status(400).json({ message: 'Ahır adı gerekli.' }); barn.name = name; }
  if (fullName !== undefined) barn.fullName = fullName;
  if (heads !== undefined) barn.heads = Math.max(0, Number(heads) || 0);
  applyLayout(barn, layout);
  await barn.save();
  res.json(barn);
});

router.delete('/barns/:id', ownerOnly, async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Ahır bulunamadı.' });
  await Barn.deleteOne({ _id: req.params.id, owner: req.farmId });
  await Robot.updateMany({ owner: req.farmId, barn: req.params.id }, { $unset: { barn: 1 } });
  res.json({ success: true });
});

// ───────── Robotlar ─────────

router.get('/robots', async (req, res) => {
  const robots = await Robot.find({ owner: req.farmId }).populate('barn').sort('name');
  res.json(robots.map((r) => r.toApp()));
});

// Robot eşleştirme: seri numarası girilir (Bluetooth'ta robottan okunur), robota yazılacak cihaz anahtarı BİR KEZ döner.
// Aynı robot bu çiftlikte zaten kayıtlıysa (ör. Bluetooth kurulumu yarıda kaldı) yeni anahtar üretilir.
router.post('/robots', ownerOnly, async (req, res) => {
  const { name, serialNumber, barnId } = req.body;
  if (!name || !serialNumber) return res.status(400).json({ message: 'Robot adı ve seri numarası gerekli.' });
  if (barnId && !(validId(barnId) && await Barn.exists({ _id: barnId, owner: req.farmId }))) return res.status(400).json({ message: 'Ahır bulunamadı.' });

  const serial = String(serialNumber).trim();
  const deviceKey = crypto.randomBytes(24).toString('hex');

  const existing = await Robot.findOne({ serialNumber: serial });
  if (existing) {
    if (String(existing.owner) !== String(req.farmId)) return res.status(400).json({ message: 'Bu robot başka bir hesaba kayıtlı. Önce o hesaptan silinmeli.' });
    existing.name = name;
    existing.barn = barnId || existing.barn;
    existing.deviceKeyHash = sha256(deviceKey);
    await existing.save();
    await existing.populate('barn');
    return res.json({ robot: existing.toApp(), deviceKey, repaired: true });
  }

  try {
    const robot = await Robot.create({ owner: req.farmId, name, serialNumber: serial, barn: barnId || undefined, deviceKeyHash: sha256(deviceKey) });
    await robot.populate('barn');
    res.status(201).json({ robot: robot.toApp(), deviceKey });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Bu seri numarası zaten kayıtlı.' });
    throw error;
  }
});

const findRobot = async (req, res) => {
  if (!validId(req.params.id)) { res.status(404).json({ message: 'Robot bulunamadı.' }); return null; }
  const robot = await Robot.findOne({ _id: req.params.id, owner: req.farmId });
  if (!robot) res.status(404).json({ message: 'Robot bulunamadı.' });
  return robot;
};

router.post('/robots/:id/command', async (req, res) => {
  const robot = await findRobot(req, res);
  if (!robot) return;
  const { command, payload } = req.body;
  if (!Robot.COMMANDS.includes(command)) return res.status(400).json({ message: 'Geçersiz komut.' });
  if (command === 'ota') {
    if (!['owner', 'manager'].includes(req.farmRole)) return res.status(403).json({ message: 'Yazılım güncellemesi için yönetici yetkisi gerekir.' });
    if (!/^https?:\/\/\S+$/i.test(String(payload?.url || ''))) return res.status(400).json({ message: 'Geçerli bir .bin adresi girin (http/https).' });
  }

  // Yön komutları üst üste birikmesin: kuyrukta sadece en sonuncusu kalsın
  if (command === 'drive') robot.pendingCommands = robot.pendingCommands.filter((c) => c.command !== 'drive');
  // Acil durdurma her şeyin önüne geçer
  if (command === 'stop') robot.pendingCommands = [];
  if (command === 'ota') {
    robot.pendingCommands = robot.pendingCommands.filter((c) => c.command !== 'ota');
    robot.ota = { state: 'queued', url: payload.url, version: payload.version, from: robot.firmwareVersion, at: new Date() };
  }
  robot.pendingCommands.push({ command, payload });
  if (robot.pendingCommands.length > 20) robot.pendingCommands = robot.pendingCommands.slice(-20);
  await robot.save();
  res.json({ success: true, queued: robot.pendingCommands.length });
});

router.put('/robots/:id/settings', canEdit, async (req, res) => {
  const robot = await findRobot(req, res);
  if (!robot) return;
  const { mode, speed, pressure, slowForAnimals } = req.body;
  if (mode !== undefined) robot.settings.mode = mode;
  if (speed !== undefined) robot.settings.speed = Number(speed);
  if (pressure !== undefined) robot.settings.pressure = Number(pressure);
  if (slowForAnimals !== undefined) robot.settings.slowForAnimals = !!slowForAnimals;
  try {
    await robot.save();
  } catch (error) {
    return res.status(400).json({ message: 'Ayar değerleri geçersiz.' });
  }
  res.json({ success: true, settings: robot.settings });
});

router.put('/robots/:id', canEdit, async (req, res) => {
  const robot = await findRobot(req, res);
  if (!robot) return;
  const { name, barnId } = req.body;
  if (name) robot.name = name;
  if (barnId !== undefined) {
    if (barnId && !(validId(barnId) && await Barn.exists({ _id: barnId, owner: req.farmId }))) return res.status(400).json({ message: 'Ahır bulunamadı.' });
    robot.barn = barnId || undefined;
  }
  await robot.save();
  await robot.populate('barn');
  res.json(robot.toApp());
});

// Anahtar kaybolursa / robot el değiştirirse yeni cihaz anahtarı (eskisi geçersiz olur)
router.post('/robots/:id/rotate-key', ownerOnly, async (req, res) => {
  const robot = await findRobot(req, res);
  if (!robot) return;
  const deviceKey = crypto.randomBytes(24).toString('hex');
  robot.deviceKeyHash = sha256(deviceKey);
  await robot.save();
  res.json({ serialNumber: robot.serialNumber, deviceKey });
});

// Bakım yapıldı: sayaç sıfırlanır
router.post('/robots/:id/maintenance/:key', canEdit, async (req, res) => {
  const robot = await findRobot(req, res);
  if (!robot) return;
  if (!['brush', 'tracks', 'battery'].includes(req.params.key)) return res.status(400).json({ message: 'Geçersiz bakım kalemi.' });
  robot.maintenance[req.params.key] = { lastAt: robot.runMinutes || 0, doneAt: new Date(), notified: false };
  await robot.save();
  await robot.populate('barn');
  res.json(robot.toApp());
});

router.delete('/robots/:id', ownerOnly, async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Robot bulunamadı.' });
  const r = await Robot.findOneAndDelete({ _id: req.params.id, owner: req.farmId });
  if (r) await Task.deleteMany({ robot: r._id, status: { $in: ['pending', 'running'] } });
  res.json({ success: true });
});

// ───────── Görevler ─────────

const taskToApp = (t) => ({
  id: String(t._id), date: t.date, time: t.time, title: t.title,
  robotId: t.robot?._id ? String(t.robot._id) : String(t.robot),
  robotName: t.robot?.name, barn: t.barn?.name ?? '', mode: t.mode, status: t.status, progress: t.progress,
});

const programToApp = async (user) => {
  const p = user.autoProgram || {};
  const barn = p.barnId ? await Barn.findById(p.barnId) : null;
  return {
    enabled: !!p.enabled, everyHours: p.everyHours, barnId: barn ? String(barn._id) : null, barn: barn?.name ?? 'Tüm ahırlar',
    from: p.from, to: p.to, waitDuringMilking: !!p.waitDuringMilking, quietNight: !!p.quietNight, milkingTimes: p.milkingTimes,
    slots: programSlots(p),
  };
};

// Programdan gelen bugünkü turlar (silinemez, uygulamada "Otomatik" etiketiyle görünür)
const autoTasksToday = async (user) => {
  const p = user.autoProgram;
  const slots = programSlots(p);
  if (!slots.length) return [];
  const robotFilter = { owner: user._id };
  if (p.barnId) robotFilter.barn = p.barnId;
  const robots = await Robot.find(robotFilter).populate('barn', 'name').sort('name');
  if (!robots.length) return [];
  const { date, time } = nowLocal();
  const robot = robots[0];
  const lastDone = robots.map((r) => r.lastAutoSlot || '').sort().pop();
  return slots.map((t) => ({
    id: `auto-${t}`, auto: true, date, time: t, title: 'Otomatik tur', robotId: String(robot._id), robotName: robot.name,
    barn: p.barnId ? robot.barn?.name ?? '' : 'Tüm ahırlar', mode: 'Program',
    status: `${date} ${t}` <= lastDone ? 'done' : 'pending', progress: 0,
  })).map((t) => (t.status === 'pending' && t.time <= time && robots.some((r) => r.liveStatus === 'cleaning') ? { ...t, status: 'running' } : t));
};

router.get('/tasks', async (req, res) => {
  const { date: today } = nowLocal();
  const filter = { owner: req.farmId };
  if (req.query.date) filter.date = req.query.date;
  else filter.date = { $gte: today };
  const tasks = (await Task.find(filter).populate('robot', 'name').populate('barn', 'name').sort({ date: 1, time: 1 })).map(taskToApp);

  if (!req.query.date || req.query.date === today) {
    tasks.push(...await autoTasksToday(req.farmOwner));
    tasks.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }

  res.json({ tasks, program: await programToApp(req.farmOwner) });
});

router.post('/tasks', canEdit, async (req, res) => {
  const { date, time, title, robotId, barn, barnId, mode } = req.body;
  if (!validId(robotId)) return res.status(400).json({ message: 'Robot seçilmeli.' });
  const robot = await Robot.findOne({ _id: robotId, owner: req.farmId });
  if (!robot) return res.status(400).json({ message: 'Robot bulunamadı.' });

  let barnDoc = null;
  if (barnId && validId(barnId)) barnDoc = await Barn.findOne({ _id: barnId, owner: req.farmId });
  else if (barn) barnDoc = await Barn.findOne({ owner: req.farmId, name: barn });

  try {
    const task = await Task.create({ owner: req.farmId, robot: robot._id, barn: barnDoc?._id ?? robot.barn, date, time, title: title || `${barnDoc?.name ?? 'Ahır'} temizliği`, mode });
    await task.populate('robot', 'name');
    await task.populate('barn', 'name');
    res.status(201).json(taskToApp(task));
  } catch (error) {
    res.status(400).json({ message: 'Tarih veya saat geçersiz.' });
  }
});

router.delete('/tasks/:id', canEdit, async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Görev bulunamadı.' });
  await Task.deleteOne({ _id: req.params.id, owner: req.farmId });
  res.json({ success: true });
});

router.put('/program', canEdit, async (req, res) => {
  const b = req.body || {};
  const p = req.farmOwner.autoProgram;
  if (b.enabled !== undefined) p.enabled = !!b.enabled;
  if (b.everyHours !== undefined) {
    const n = Number(b.everyHours);
    if (!(n >= 1 && n <= 12)) return res.status(400).json({ message: 'Tur aralığı 1-12 saat olmalı.' });
    p.everyHours = n;
  }
  if (b.from !== undefined) { if (!isValidTime(b.from)) return res.status(400).json({ message: 'Başlangıç saati geçersiz.' }); p.from = b.from; }
  if (b.to !== undefined) { if (!isValidTime(b.to, true)) return res.status(400).json({ message: 'Bitiş saati geçersiz.' }); p.to = b.to; }
  if (b.barnId !== undefined) {
    if (b.barnId && !(validId(b.barnId) && await Barn.exists({ _id: b.barnId, owner: req.farmId }))) return res.status(400).json({ message: 'Ahır bulunamadı.' });
    p.barnId = b.barnId || undefined;
  }
  if (b.waitDuringMilking !== undefined) p.waitDuringMilking = !!b.waitDuringMilking;
  if (b.quietNight !== undefined) p.quietNight = !!b.quietNight;
  if (Array.isArray(b.milkingTimes)) {
    if (!b.milkingTimes.every((t) => isValidTime(t))) return res.status(400).json({ message: 'Sağım saatleri geçersiz.' });
    p.milkingTimes = b.milkingTimes.slice(0, 4);
  }
  await req.farmOwner.save();
  res.json({ success: true, program: await programToApp(req.farmOwner) });
});

// ───────── Bildirimler ─────────

router.get('/notifications', async (req, res) => {
  const list = await Notification.find({ owner: req.farmId }).sort('-createdAt').limit(50);
  res.json(list.map((n) => ({ id: String(n._id), type: n.type, code: n.code || null, title: n.title, body: n.body, read: n.read, ago: ago(n.createdAt), createdAt: n.createdAt })));
});

router.post('/notifications/read-all', async (req, res) => {
  await Notification.updateMany({ owner: req.farmId, read: false }, { read: true });
  res.json({ success: true });
});

// Telefonun Expo push token'ı (uygulama her açılışta gönderir)
router.post('/notifications/register-token', async (req, res) => {
  const { pushToken, platform, installationId, deviceName } = req.body || {};
  if (!/^Expo(nent)?PushToken\[.+\]$/.test(String(pushToken || ''))) return res.status(400).json({ message: 'Geçersiz push token.' });
  // Aynı token başka hesapta kaldıysa oradan sil (telefonda hesap değişti)
  await User.updateMany({ _id: { $ne: req.user._id } }, { $pull: { pushTokens: { token: pushToken } } });
  await User.updateOne({ _id: req.user._id }, { $pull: { pushTokens: { $or: [{ token: pushToken }, ...(installationId ? [{ installationId }] : [])] } } });
  await User.updateOne({ _id: req.user._id }, { $push: { pushTokens: { $each: [{ token: pushToken, platform, installationId, deviceName, updatedAt: new Date() }], $slice: -10 } } });
  res.json({ success: true });
});

router.post('/notifications/unregister-token', async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $pull: { pushTokens: { token: String(req.body?.pushToken || '') } } });
  res.json({ success: true });
});

// ───────── Tur geçmişi (CSV/PDF dışa aktarma uygulamada yapılır) ─────────
router.get('/history', async (req, res) => {
  const days = Math.max(1, Math.min(366, Number(req.query.days) || 30));
  const filter = { owner: req.farmId, finishedAt: { $gte: new Date(Date.now() - days * 86400000) } };
  if (req.query.robotId && validId(req.query.robotId)) filter.robot = req.query.robotId;
  const runs = await CleaningRun.find(filter).populate('robot', 'name').populate('barn', 'name').sort('-finishedAt').limit(1000);
  res.json(runs.map((r) => ({
    id: String(r._id), finishedAt: r.finishedAt, robotName: r.robot?.name ?? '', barnName: r.barn?.name ?? '',
    area: r.area, durationMin: r.durationMin, wasteKg: r.wasteKg, areaM2: r.areaM2, ammonia: r.ammonia ?? null, hygiene: r.hygiene ?? null,
  })));
});

// ───────── Raporlar ─────────

const RANGE = {
  week: { days: 7, label: 'Bu hafta' },
  month: { days: 30, label: 'Bu ay' },
  year: { days: 365, label: 'Bu yıl' },
};
const DAY_NAMES = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTH_NAMES = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const AREA_META = { walkway: ['Yürüme koridoru', '#1b7a52'], milking: ['Sağım bölümü', '#b8e04a'], calf: ['Buzağı bölmesi', '#f2a93b'], other: ['Diğer', '#3a8dde'] };

const fmtWaste = (kg) => (kg >= 1000 ? `${(kg / 1000).toFixed(1).replace('.', ',')} ton` : `${Math.round(kg)} kg`);
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const delta = (cur, prev, unit, invert) => {
  if (cur == null || prev == null || prev === 0) return '';
  if (unit === 'puan') { const d = Math.round(cur - prev); return `${d >= 0 ? '▲' : '▼'} ${Math.abs(d)} puan`; }
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct >= 0 ? '▲' : '▼'} %${Math.abs(pct)}`;
};

router.get('/reports', async (req, res) => {
  const range = RANGE[req.query.range] ? req.query.range : 'week';
  const { days, label } = RANGE[range];
  const now = Date.now();
  const since = new Date(now - days * 86400000);
  const prevSince = new Date(now - 2 * days * 86400000);

  const [runs, prevRuns] = await Promise.all([
    CleaningRun.find({ owner: req.farmId, finishedAt: { $gte: since } }),
    CleaningRun.find({ owner: req.farmId, finishedAt: { $gte: prevSince, $lt: since } }),
  ]);

  // Grafik çubukları: hafta = 7 gün, ay = 4 hafta, yıl = 12 ay
  let buckets;
  if (range === 'week') {
    buckets = Array.from({ length: 7 }, (_, i) => { const d = new Date(now - (6 - i) * 86400000); return { d: DAY_NAMES[d.getDay()], key: d.toISOString().slice(0, 10), v: 0 }; });
    runs.forEach((r) => { const b = buckets.find((x) => x.key === r.finishedAt.toISOString().slice(0, 10)); if (b) b.v += r.wasteKg; });
  } else if (range === 'month') {
    buckets = Array.from({ length: 4 }, (_, i) => ({ d: `${i + 1}.H`, v: 0 }));
    runs.forEach((r) => { const i = Math.min(3, Math.floor((r.finishedAt - since) / (7.5 * 86400000))); buckets[i].v += r.wasteKg; });
  } else {
    buckets = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - (11 - i)); return { d: MONTH_NAMES[d.getMonth()], m: d.getMonth(), y: d.getFullYear(), v: 0 }; });
    runs.forEach((r) => { const b = buckets.find((x) => x.m === r.finishedAt.getMonth() && x.y === r.finishedAt.getFullYear()); if (b) b.v += r.wasteKg; });
  }

  const totalKg = runs.reduce((a, r) => a + r.wasteKg, 0);
  const byArea = {};
  runs.forEach((r) => { byArea[r.area] = (byArea[r.area] || 0) + r.wasteKg; });
  const areas = Object.entries(byArea).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: AREA_META[k][0], color: AREA_META[k][1], pct: totalKg ? Math.round((v / totalKg) * 100) : 0 }));

  const hyg = avg(runs.map((r) => r.hygiene).filter((x) => x != null));
  const hygPrev = avg(prevRuns.map((r) => r.hygiene).filter((x) => x != null));
  const amm = avg(runs.map((r) => r.ammonia).filter((x) => x != null));
  const ammPrev = avg(prevRuns.map((r) => r.ammonia).filter((x) => x != null));

  res.json({
    label,
    totalWaste: fmtWaste(totalKg),
    runs: runs.length,
    bars: buckets.map((b) => ({ d: b.d, v: Math.round(b.v) || 0.0001 })),
    hygiene: hyg == null ? '–' : Math.round(hyg),
    hygieneDelta: delta(hyg, hygPrev, 'puan'),
    ammonia: amm == null ? '–' : Math.round(amm),
    ammoniaDelta: delta(amm, ammPrev),
    areas: areas.length ? areas : [{ label: 'Henüz veri yok', color: '#e3ebe6', pct: 100 }],
  });
});

module.exports = router;
