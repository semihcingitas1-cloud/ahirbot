const express = require('express');
const crypto = require('crypto');

const Barn = require('../models/Barn');
const Robot = require('../models/Robot');
const Task = require('../models/Task');
const Notification = require('../models/Notification');
const CleaningRun = require('../models/CleaningRun');
const { requireUser, sha256 } = require('../middleware/auth');

// Uygulamanın kullandığı API'ler (AhırBot src/redux/robotSlice.js ile birebir)
const router = express.Router();
router.use(requireUser);

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
  const barns = await Barn.find({ owner: req.user._id }).sort('createdAt');
  res.json(barns);
});

router.post('/barns', async (req, res) => {
  const { name, fullName, heads, corridors } = req.body;
  if (!name) return res.status(400).json({ message: 'Ahır adı gerekli.' });
  const barn = await Barn.create({ owner: req.user._id, name, fullName, heads, corridors });
  res.status(201).json(barn);
});

router.delete('/barns/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Ahır bulunamadı.' });
  await Barn.deleteOne({ _id: req.params.id, owner: req.user._id });
  res.json({ success: true });
});

// ───────── Robotlar ─────────

router.get('/robots', async (req, res) => {
  const robots = await Robot.find({ owner: req.user._id }).populate('barn').sort('name');
  res.json(robots.map((r) => r.toApp()));
});

// Robot eşleştirme: seri numarası girilir, robota yazılacak cihaz anahtarı BİR KEZ döner
router.post('/robots', async (req, res) => {
  const { name, serialNumber, barnId } = req.body;
  if (!name || !serialNumber) return res.status(400).json({ message: 'Robot adı ve seri numarası gerekli.' });
  if (barnId && !(validId(barnId) && await Barn.exists({ _id: barnId, owner: req.user._id }))) return res.status(400).json({ message: 'Ahır bulunamadı.' });

  const deviceKey = crypto.randomBytes(24).toString('hex');
  try {
    const robot = await Robot.create({ owner: req.user._id, name, serialNumber: String(serialNumber).trim(), barn: barnId || undefined, deviceKeyHash: sha256(deviceKey) });
    await robot.populate('barn');
    res.status(201).json({ robot: robot.toApp(), deviceKey });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Bu seri numarası zaten kayıtlı.' });
    throw error;
  }
});

const findRobot = async (req, res) => {
  if (!validId(req.params.id)) { res.status(404).json({ message: 'Robot bulunamadı.' }); return null; }
  const robot = await Robot.findOne({ _id: req.params.id, owner: req.user._id });
  if (!robot) res.status(404).json({ message: 'Robot bulunamadı.' });
  return robot;
};

router.post('/robots/:id/command', async (req, res) => {
  const robot = await findRobot(req, res);
  if (!robot) return;
  const { command, payload } = req.body;
  if (!Robot.COMMANDS.includes(command)) return res.status(400).json({ message: 'Geçersiz komut.' });

  // Yön komutları üst üste birikmesin: kuyrukta sadece en sonuncusu kalsın
  if (command === 'drive') robot.pendingCommands = robot.pendingCommands.filter((c) => c.command !== 'drive');
  // Acil durdurma her şeyin önüne geçer
  if (command === 'stop') robot.pendingCommands = [];
  robot.pendingCommands.push({ command, payload });
  if (robot.pendingCommands.length > 20) robot.pendingCommands = robot.pendingCommands.slice(-20);
  await robot.save();
  res.json({ success: true, queued: robot.pendingCommands.length });
});

router.put('/robots/:id/settings', async (req, res) => {
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

router.put('/robots/:id', async (req, res) => {
  const robot = await findRobot(req, res);
  if (!robot) return;
  const { name, barnId, cameraUrl } = req.body;
  if (name) robot.name = name;
  if (barnId !== undefined) robot.barn = barnId || undefined;
  if (cameraUrl !== undefined) robot.cameraUrl = cameraUrl;
  await robot.save();
  await robot.populate('barn');
  res.json(robot.toApp());
});

router.delete('/robots/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Robot bulunamadı.' });
  await Robot.deleteOne({ _id: req.params.id, owner: req.user._id });
  res.json({ success: true });
});

// ───────── Görevler ─────────

const taskToApp = (t) => ({
  id: String(t._id), date: t.date, time: t.time, title: t.title,
  robotId: t.robot?._id ? String(t.robot._id) : String(t.robot),
  robotName: t.robot?.name, barn: t.barn?.name ?? '', mode: t.mode, status: t.status, progress: t.progress,
});

router.get('/tasks', async (req, res) => {
  const filter = { owner: req.user._id };
  if (req.query.date) filter.date = req.query.date;
  else filter.date = { $gte: new Date(Date.now() - 86400000).toISOString().slice(0, 10) };
  const tasks = await Task.find(filter).populate('robot', 'name').populate('barn', 'name').sort({ date: 1, time: 1 });

  const p = req.user.autoProgram;
  const programBarn = p?.barnId ? await Barn.findById(p.barnId) : null;
  const program = p?.enabled ? { everyHours: p.everyHours, barn: programBarn?.name ?? 'Tüm ahırlar', from: p.from, to: p.to, waitDuringMilking: p.waitDuringMilking, quietNight: p.quietNight } : null;

  res.json({ tasks: tasks.map(taskToApp), program });
});

router.post('/tasks', async (req, res) => {
  const { date, time, title, robotId, barn, barnId, mode } = req.body;
  if (!validId(robotId)) return res.status(400).json({ message: 'Robot seçilmeli.' });
  const robot = await Robot.findOne({ _id: robotId, owner: req.user._id });
  if (!robot) return res.status(400).json({ message: 'Robot bulunamadı.' });

  let barnDoc = null;
  if (barnId && validId(barnId)) barnDoc = await Barn.findOne({ _id: barnId, owner: req.user._id });
  else if (barn) barnDoc = await Barn.findOne({ owner: req.user._id, name: barn });

  try {
    const task = await Task.create({ owner: req.user._id, robot: robot._id, barn: barnDoc?._id ?? robot.barn, date, time, title: title || `${barnDoc?.name ?? 'Ahır'} temizliği`, mode });
    await task.populate('robot', 'name');
    await task.populate('barn', 'name');
    res.status(201).json(taskToApp(task));
  } catch (error) {
    res.status(400).json({ message: 'Tarih veya saat geçersiz.' });
  }
});

router.delete('/tasks/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Görev bulunamadı.' });
  await Task.deleteOne({ _id: req.params.id, owner: req.user._id });
  res.json({ success: true });
});

router.put('/program', async (req, res) => {
  Object.assign(req.user.autoProgram, req.body);
  await req.user.save();
  res.json({ success: true, program: req.user.autoProgram });
});

// ───────── Bildirimler ─────────

router.get('/notifications', async (req, res) => {
  const list = await Notification.find({ owner: req.user._id }).sort('-createdAt').limit(50);
  res.json(list.map((n) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body, read: n.read, ago: ago(n.createdAt), createdAt: n.createdAt })));
});

router.post('/notifications/read-all', async (req, res) => {
  await Notification.updateMany({ owner: req.user._id, read: false }, { read: true });
  res.json({ success: true });
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
    CleaningRun.find({ owner: req.user._id, finishedAt: { $gte: since } }),
    CleaningRun.find({ owner: req.user._id, finishedAt: { $gte: prevSince, $lt: since } }),
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
