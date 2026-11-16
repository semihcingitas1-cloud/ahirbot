const express = require('express');

const { requireDevice } = require('../middleware/auth');
const { applyTelemetry, drainCommands, recordRun, recordEvent } = require('../lib/device');

// ─────────────────────────────────────────────────────────────
// Robotun HTTP API'si (yedek yol). Asıl bağlantı WebSocket: ws-gateway.js.
// WebSocket kullanamayan cihaz birkaç saniyede bir telemetri gönderir; cevapta komutlarını alır.
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

module.exports = router;
