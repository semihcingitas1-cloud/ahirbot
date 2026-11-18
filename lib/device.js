const Robot = require('../models/Robot');
const Task = require('../models/Task');
const Notification = require('../models/Notification');
const CleaningRun = require('../models/CleaningRun');
const User = require('../models/User');
const { sha256 } = require('../middleware/auth');
const Barn = require('../models/Barn');
const { nowLocal, programSlots } = require('./schedule');
const { sendPush } = require('./push');
const { status: maintenanceStatus } = require('./maintenance');

// ─────────────────────────────────────────────────────────────
// Robot mesajlarının mantığı (routes/device.js kullanır).
// ─────────────────────────────────────────────────────────────

const TELEMETRY_FIELDS = ['status', 'progress', 'corridor', 'corridorTotal', 'battery', 'tank', 'tankCapacityL', 'water', 'waterCapacityL', 'cleanedArea', 'ammonia', 'speed', 'routeLengthM', 'etaMin'];
const PERCENT = ['progress', 'battery', 'tank', 'water'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));

// Bildirim kaydı + telefonlara push (Vercel'de cevap dönmeden önce bitmesi için await edilir)
// code: uygulamadaki alarm rehberindeki kod (E01 yol kapalı, E02 hazne… bkz. ahirbot/src/data/alarms.js)
const notify = async (robot, type, title, body, code) => {
  await Notification.create({ owner: robot.owner, robot: robot._id, type, title, body, code });
  await sendPush(robot.owner, { title, body, type, data: { robotId: String(robot._id), code } });
};

const CODE_RE = /^[EM]\d{2}$/;

const authDevice = async (serial, key) => {
  if (!serial || !key) return null;
  const robot = await Robot.findOne({ serialNumber: String(serial) }).select('+deviceKeyHash');
  if (!robot || robot.deviceKeyHash !== sha256(key)) return null;
  return robot;
};

// Bekleyen komutları atomik olarak alır ve kuyruğu boşaltır
const drainCommands = async (robotId) => {
  const old = await Robot.findOneAndUpdate(
    { _id: robotId, 'pendingCommands.0': { $exists: true } },
    { $set: { pendingCommands: [] } },
    { new: false, projection: { pendingCommands: 1 } },
  );
  if (!old) return [];
  if (old.pendingCommands.some((c) => c.command === 'ota')) {
    await Robot.updateOne({ _id: robotId, 'ota.state': 'queued' }, { $set: { 'ota.state': 'sent', 'ota.at': new Date() } });
  }
  return old.pendingCommands.map((c) => ({ command: c.command, payload: c.payload ?? null }));
};

// Robotun bildirdiği güncelleme durumu: POST /device/ota { state, version, from, detail }
const OTA_STATES = ['downloading', 'success', 'failed', 'no_update'];
const recordOta = async (robotId, b = {}) => {
  if (!OTA_STATES.includes(b.state)) return false;
  const robot = await Robot.findById(robotId);
  if (!robot) return false;
  const detail = b.detail ? String(b.detail).slice(0, 200) : undefined;
  const set = { 'ota.state': b.state, 'ota.at': new Date(), 'ota.detail': detail };
  if (b.version) set['ota.version'] = String(b.version).slice(0, 32);
  if (b.from) set['ota.from'] = String(b.from).slice(0, 32);
  if (b.state === 'success' && b.version) set.firmwareVersion = String(b.version).slice(0, 32);
  await Robot.updateOne({ _id: robot._id }, { $set: set });

  if (b.state === 'success') await notify(robot, 'info', 'Yazılım güncellendi', `${robot.name}: ${b.from || '?'} → ${b.version || '?'}`);
  if (b.state === 'failed') await notify(robot, 'error', 'Güncelleme başarısız', `${robot.name}: ${detail || 'bilinmeyen hata'}. Robot eski yazılımla çalışmaya devam ediyor.`, 'E08');
  return true;
};

// Bugünün görevleri + otomatik programdan gelen turlar
const todayTasks = async (robot) => {
  const { date, time } = nowLocal();
  const tasks = (await Task.find({ robot: robot._id, date, status: { $in: ['pending', 'running'] } }).sort('time'))
    .map((t) => ({ id: String(t._id), time: t.time, title: t.title, mode: t.mode, status: t.status }));

  const owner = await User.findById(robot.owner);
  const p = owner?.autoProgram;
  if (p?.enabled && (!p.barnId || String(p.barnId) === String(robot.barn))) {
    const pending = programSlots(p).filter((t) => `${date} ${t}` > (robot.lastAutoSlot || ''));
    const due = pending.filter((t) => t <= time);
    const next = [...(due.length ? [due[due.length - 1]] : []), ...pending.filter((t) => t > time)];
    tasks.push(...next.map((t) => ({ id: `auto-${t}`, time: t, title: 'Otomatik tur', mode: robot.settings.mode, status: 'pending' })));
    tasks.sort((a, b) => a.time.localeCompare(b.time));
  }
  return { tasks, localTime: time };
};

// Telemetri kaydeder (komut kuyruğuna dokunmaz), bildirim üretir, senkron bilgisini döner
const applyTelemetry = async (robotId, b = {}) => {
  const robot = await Robot.findById(robotId);
  if (!robot) return null;
  const before = { status: robot.liveStatus, tank: robot.tank, ammonia: robot.ammonia };

  const set = { lastSeenAt: new Date() };
  for (const f of TELEMETRY_FIELDS) {
    if (b[f] === undefined) continue;
    if (f === 'status') { if (Robot.STATUSES.includes(b.status)) set.status = b.status; continue; }
    set[f] = PERCENT.includes(f) ? clamp(b[f], 0, 100) : Number(b[f]) || 0;
  }
  if (b.position) set.position = { x: clamp(b.position.x ?? 0, 0, 1), y: clamp(b.position.y ?? 0, 0, 1) };
  if (b.firmwareVersion) set.firmwareVersion = String(b.firmwareVersion).slice(0, 32);
  await Robot.updateOne({ _id: robot._id }, { $set: set });
  Object.assign(robot, set);

  const jobs = [];
  if (robot.status === 'blocked' && before.status !== 'blocked') jobs.push(notify(robot, 'blocked', 'Yol kapalı', b.message || `${robot.name} yolda bir engel nedeniyle bekliyor.`, CODE_RE.test(b.code) ? b.code : 'E01'));
  if (robot.status === 'error' && before.status !== 'error') jobs.push(notify(robot, 'error', 'Robot arızası', b.message || `${robot.name} bir hata bildirdi.`, CODE_RE.test(b.code) ? b.code : 'E06'));
  if (robot.tank >= 85 && before.tank < 85) jobs.push(notify(robot, 'tank', 'Hazne doluyor', `Atık haznesi %${Math.round(robot.tank)}. Boşaltma gerekiyor.`, 'E02'));
  if (robot.ammonia >= 20 && before.ammonia < 20) jobs.push(notify(robot, 'ammonia', 'Amonyak yükseldi', `${robot.name} bölgesinde ${robot.ammonia} ppm ölçüldü.`, 'E10'));
  if (b.taskId && /^[a-f0-9]{24}$/i.test(b.taskId)) {
    jobs.push(Task.updateOne({ _id: b.taskId, robot: robot._id, status: { $in: ['pending', 'running'] } }, { status: 'running', progress: robot.progress }));
  }
  await Promise.all(jobs);

  const [{ tasks, localTime }, barn] = await Promise.all([todayTasks(robot), robot.barn ? Barn.findById(robot.barn) : null]);
  // layout: robot koridor sayısını ve şarj/boşaltma noktasını buradan öğrenir
  return { settings: robot.settings, layout: barn ? barn.layoutToApp() : null, tasks, serverTime: new Date().toISOString(), localTime };
};

const recordRun = async (robotId, body = {}) => {
  const robot = await Robot.findById(robotId);
  const { area = 'walkway', wasteKg = 0, areaM2 = 0, durationMin = 0, ammonia, hygiene, taskId } = body;

  const run = await CleaningRun.create({ owner: robot.owner, robot: robot._id, barn: robot.barn, area: ['walkway', 'milking', 'calf', 'other'].includes(area) ? area : 'other', wasteKg: Number(wasteKg) || 0, areaM2: Number(areaM2) || 0, durationMin: Number(durationMin) || 0, ammonia, hygiene });

  if (taskId && /^[a-f0-9]{24}$/i.test(taskId)) await Task.updateOne({ _id: taskId, robot: robot._id }, { status: 'done', progress: 100 });
  if (typeof taskId === 'string' && /^auto-\d{2}:\d{2}$/.test(taskId)) {
    await Robot.updateOne({ _id: robot._id }, { $set: { lastAutoSlot: `${nowLocal().date} ${taskId.slice(5)}` } });
  }

  // Çalışma süresi ve bakım hatırlatıcı
  const minutes = Math.max(0, Number(durationMin) || 0);
  const updated = await Robot.findByIdAndUpdate(robot._id, { $inc: { runMinutes: minutes } }, { new: true });
  for (const m of maintenanceStatus(updated)) {
    if (m.due && !updated.maintenance?.[m.key]?.notified) {
      await Robot.updateOne({ _id: robot._id }, { $set: { [`maintenance.${m.key}.notified`]: true } });
      await notify(robot, 'info', `Bakım zamanı: ${m.label}`, `${robot.name} son bakımdan bu yana ${Math.round(m.usedHours)} saat çalıştı (önerilen ${m.everyHours} saat).`, m.code);
    }
  }

  const ton = run.wasteKg >= 1000 ? `${(run.wasteKg / 1000).toFixed(1).replace('.', ',')} ton` : `${Math.round(run.wasteKg)} kg`;
  await notify(robot, 'done', 'Tur tamamlandı', `${robot.name} · ${Math.round(run.areaM2)} m² · ${ton} atık`);
  return String(run._id);
};

const EVENT_TYPES = ['blocked', 'error', 'tank', 'done', 'ammonia', 'info'];
const recordEvent = async (robotId, { type = 'info', title, body = '', code } = {}) => {
  if (!title) return false;
  const robot = await Robot.findById(robotId);
  await notify(robot, EVENT_TYPES.includes(type) ? type : 'info', String(title).slice(0, 120), String(body).slice(0, 500), CODE_RE.test(code) ? code : undefined);
  return true;
};

const markOffline = (robotId) => Robot.updateOne({ _id: robotId }, { $set: { status: 'offline' } });

module.exports = { authDevice, drainCommands, recordOta, todayTasks, applyTelemetry, recordRun, recordEvent, markOffline };
