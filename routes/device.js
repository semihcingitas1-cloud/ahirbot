const express = require('express');

const { requireDevice } = require('../middleware/auth');
const { applyTelemetry, drainCommands, recordRun, recordEvent, recordOta } = require('../lib/device');
const firmware = require('../lib/firmware');
const Robot = require('../models/Robot');

// ─────────────────────────────────────────────────────────────
// Robotun API'si. Vercel sürekli bağlantı tutamadığı için robot birkaç saniyede bir
// telemetri gönderir; cevapta bekleyen komutlarını, ayarlarını ve görevlerini alır.
// Başlıklar: X-Serial: <seri no>, X-Device-Key: <eşleştirmede verilen anahtar>
// ─────────────────────────────────────────────────────────────

const router = express.Router();
router.use('/device', requireDevice);

router.post('/device/telemetry', async (req, res) => {
  const sync = await applyTelemetry(req.robot._id, req.body || {});
  const commands = await drainCommands(req.robot._id);
  res.json({ commands, ...sync });
});

router.post('/device/run', async (req, res) => {
  const id = await recordRun(req.robot._id, req.body || {});
  res.status(201).json({ success: true, id });
});

router.post('/device/event', async (req, res) => {
  if (!(await recordEvent(req.robot._id, req.body || {}))) return res.status(400).json({ message: 'title gerekli' });
  res.status(201).json({ success: true });
});

// Güncelleme durumu (indirmeye başladı / bitti / hata)
router.post('/device/ota', async (req, res) => {
  if (!(await recordOta(req.robot._id, req.body || {}))) return res.status(400).json({ message: 'Geçersiz durum' });
  res.json({ success: true });
});

// Yönetici panelinden yüklenen .bin dosyası. Sadece kayıtlı robotlar (X-Serial + X-Device-Key) indirebilir.
// x-MD5 başlığı: robot yazdıktan sonra dosyanın bozulmadığını kontrol eder.
router.get('/device/firmware/:id', async (req, res) => {
  const fw = await firmware.get(req.params.id);
  if (!fw) return res.status(404).json({ message: 'Yazılım dosyası bulunamadı (silinmiş olabilir).' });
  const buf = await firmware.read(fw.id);
  await Robot.updateOne({ _id: req.robot._id }, { $set: { 'ota.state': 'downloading', 'ota.at': new Date(), 'ota.firmwareId': fw.id } });
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(buf.length),
    'Content-Disposition': `attachment; filename="${fw.filename.replace(/[^\w.-]/g, '_')}"`,
    'x-MD5': fw.md5 || '',
    'X-Firmware-Version': fw.version || '',
    'Cache-Control': 'no-store',
  });
  res.end(buf);
});

module.exports = router;
