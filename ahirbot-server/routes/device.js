const express = require('express');

const Robot = require('../models/Robot');
const Task = require('../models/Task');
const Notification = require('../models/Notification');
const CleaningRun = require('../models/CleaningRun');
const { requireDevice } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────
// Robotun (ESP32 / Raspberry Pi vb.) kullandığı API.
// Vercel sürekli açık bağlantı (MQTT broker, socket) tutamadığı için robot birkaç saniyede bir
// telemetri gönderir; cevapta bekleyen komutlarını, ayarlarını ve bugünkü görevlerini alır.
// Başlıklar: X-Serial: <seri no>, X-Device-Key: <eşleştirmede verilen anahtar>
// ─────────────────────────────────────────────────────────────

const router = express.Router();
router.use('/device', requireDevice);

const TELEMETRY_FIELDS = ['status', 'progress', 'corridor', 'corridorTotal', 'battery', 'tank', 'tankCapacityL', 'water', 'waterCapacityL', 'cleanedArea', 'ammonia', 'speed', 'routeLengthM', 'etaMin', 'cameraUrl'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v)));
const today = () => new Date().toISOString().slice(0, 10);

const notify = (robot, type, title, body) => Notification.create({ owner: robot.owner, robot: robot._id, type, title, body });

router.post('/device/telemetry', async (req, res) => {
  const robot = req.robot;
  const before = { status: robot.liveStatus, tank: robot.tank, ammonia: robot.ammonia };
  const b = req.body || {};

  for (const f of TELEMETRY_FIELDS) {
    if (b[f] === undefined) continue;
    if (f === 'status') { if (Robot.STATUSES.includes(b.status)) robot.status = b.status; continue; }
    if (f === 'cameraUrl') { robot.cameraUrl = String(b.cameraUrl); continue; }
    robot[f] = ['progress', 'battery', 'tank', 'water'].includes(f) ? clamp(b[f], 0, 100) : Number(b[f]) || 0;
  }
  if (b.position) robot.position = { x: clamp(b.position.x ?? 0, 0, 1), y: clamp(b.position.y ?? 0, 0, 1) };
  robot.lastSeenAt = new Date();

  // Uygulamaya giden komutlar robota teslim edildi
  const commands = robot.pendingCommands.map((c) => ({ command: c.command, payload: c.payload ?? null }));
  robot.pendingCommands = [];
  await robot.save();

  // Durum değişikliklerinden otomatik bildirim
  const jobs = [];
  if (robot.status === 'blocked' && before.status !== 'blocked') jobs.push(notify(robot, 'blocked', 'Yol kapalı', b.message || `${robot.name} yolda bir engel nedeniyle bekliyor.`));
  if (robot.status === 'error' && before.status !== 'error') jobs.push(notify(robot, 'error', 'Robot arızası', b.message || `${robot.name} bir hata bildirdi.`));
  if (robot.tank >= 85 && before.tank < 85) jobs.push(notify(robot, 'tank', 'Hazne doluyor', `Atık haznesi %${Math.round(robot.tank)}. Boşaltma gerekiyor.`));
  if (robot.ammonia >= 20 && before.ammonia < 20) jobs.push(notify(robot, 'ammonia', 'Amonyak yükseldi', `${robot.name} bölgesinde ${robot.ammonia} ppm ölçüldü.`));

  // Robot hangi görevi yürüttüğünü bildirirse görev ilerlemesi güncellenir
  if (b.taskId && /^[a-f0-9]{24}$/i.test(b.taskId)) {
    jobs.push(Task.updateOne({ _id: b.taskId, robot: robot._id, status: { $in: ['pending', 'running'] } }, { status: 'running', progress: robot.progress }));
  }
  await Promise.all(jobs);

  const tasks = await Task.find({ robot: robot._id, date: today(), status: { $in: ['pending', 'running'] } }).sort('time');

  res.json({
    commands,
    settings: robot.settings,
    tasks: tasks.map((t) => ({ id: String(t._id), time: t.time, title: t.title, mode: t.mode, status: t.status })),
    serverTime: new Date().toISOString(),
  });
});

// Tamamlanan tur: raporlara işlenir, görev kapanır, bildirim düşer
router.post('/device/run', async (req, res) => {
  const robot = req.robot;
  const { area = 'walkway', wasteKg = 0, areaM2 = 0, durationMin = 0, ammonia, hygiene, taskId } = req.body || {};

  const run = await CleaningRun.create({ owner: robot.owner, robot: robot._id, barn: robot.barn, area: ['walkway', 'milking', 'calf', 'other'].includes(area) ? area : 'other', wasteKg: Number(wasteKg) || 0, areaM2: Number(areaM2) || 0, durationMin: Number(durationMin) || 0, ammonia, hygiene });

  if (taskId && /^[a-f0-9]{24}$/i.test(taskId)) await Task.updateOne({ _id: taskId, robot: robot._id }, { status: 'done', progress: 100 });

  const ton = run.wasteKg >= 1000 ? `${(run.wasteKg / 1000).toFixed(1).replace('.', ',')} ton` : `${Math.round(run.wasteKg)} kg`;
  await notify(robot, 'done', 'Tur tamamlandı', `${robot.name} · ${Math.round(run.areaM2)} m² · ${ton} atık`);

  res.status(201).json({ success: true, id: String(run._id) });
});

// Serbest olay bildirimi (ör. sıkıştı, kapak açık)
router.post('/device/event', async (req, res) => {
  const { type = 'info', title, body = '' } = req.body || {};
  if (!title) return res.status(400).json({ message: 'title gerekli' });
  await notify(req.robot, ['blocked', 'error', 'tank', 'done', 'ammonia', 'info'].includes(type) ? type : 'info', title, body);
  res.status(201).json({ success: true });
});

module.exports = router;
