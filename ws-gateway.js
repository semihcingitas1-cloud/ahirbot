require('dotenv').config();
const http = require('http');
const { WebSocketServer } = require('ws');

const connectDB = require('./lib/db');
const Robot = require('./models/Robot');
const { authDevice, drainCommands, applyTelemetry, recordRun, recordEvent, markOffline } = require('./lib/device');

// ─────────────────────────────────────────────────────────────
// AhırBot WebSocket geçidi — robotlar (ESP32) buraya sürekli bağlı kalır.
// Vercel WebSocket tutamadığı için bu dosya ayrı, sürekli çalışan bir serviste
// (Render / Railway / kendi sunucun) çalışır. Uygulama Vercel API'yi kullanmaya devam eder;
// ikisi aynı MongoDB'yi paylaşır.
//
// Bağlantı:  wss://<host>/ws   başlıklar: X-Serial, X-Device-Key
// Robot → sunucu:  {type:"hello"|"telemetry"|"run"|"event"|"ack", ...}
// Sunucu → robot:  {type:"welcome"|"sync"|"command"|"error", ...}
// ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8080;
const COMMAND_POLL_MS = Number(process.env.COMMAND_POLL_MS || 1000);
const PING_MS = 25000;

const clients = new Map(); // robotId -> ws

const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
const log = (...a) => console.log(new Date().toISOString(), ...a);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, robots: clients.size }));
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`AhırBot WebSocket geçidi çalışıyor · bağlı robot: ${clients.size}`);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') { socket.destroy(); return; }

  const serial = req.headers['x-serial'] || url.searchParams.get('serial');
  const key = req.headers['x-device-key'] || url.searchParams.get('key');

  try {
    await connectDB();
    const robot = await authDevice(serial, key);
    if (!robot) {
      log('Reddedildi:', serial || '(seri yok)');
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, robot));
  } catch (e) {
    log('Upgrade hatası:', e.message);
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
  }
});

wss.on('connection', async (ws, robot) => {
  const id = String(robot._id);
  ws.robotId = id;
  ws.alive = true;

  // Aynı robot ikinci kez bağlanırsa eskisini kapat
  const old = clients.get(id);
  if (old && old !== ws) old.close(4000, 'replaced');
  clients.set(id, ws);
  log(`Bağlandı: ${robot.serialNumber} (${robot.name}) · toplam ${clients.size}`);

  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', async (data) => {
    ws.alive = true;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return send(ws, { type: 'error', message: 'invalid_json' }); }

    try {
      switch (msg.type) {
        case 'hello':
        case 'telemetry': {
          const sync = await applyTelemetry(id, msg);
          send(ws, { type: msg.type === 'hello' ? 'welcome' : 'sync', ...sync });
          break;
        }
        case 'run': {
          const runId = await recordRun(id, msg);
          send(ws, { type: 'run_saved', id: runId, taskId: msg.taskId || null });
          break;
        }
        case 'event': // {type:"event", kind:"blocked|error|tank|info", title, body}
          await recordEvent(id, { type: msg.kind, title: msg.title, body: msg.body });
          break;
        case 'ack':
          log('Komut uygulandı:', robot.serialNumber, msg.command, msg.ok === false ? `(reddedildi: ${msg.reason || '-'})` : '');
          break;
        default:
          send(ws, { type: 'error', message: 'unknown_type' });
      }
    } catch (e) {
      log('Mesaj hatası:', robot.serialNumber, e.message);
      send(ws, { type: 'error', message: 'server_error' });
    }
  });

  ws.on('close', async () => {
    if (clients.get(id) !== ws) return;
    clients.delete(id);
    log(`Ayrıldı: ${robot.serialNumber} · toplam ${clients.size}`);
    try { await markOffline(id); } catch { /* bağlantı yoksa önemli değil */ }
  });

  // Bağlanır bağlanmaz bekleyen komutlar
  try {
    for (const c of await drainCommands(id)) send(ws, { type: 'command', ...c });
  } catch (e) { log(e.message); }
});

// Uygulama komutları Vercel API'ye yazar (pendingCommands); burada bağlı robotlara anında iletilir.
let polling = false;
setInterval(async () => {
  if (polling || clients.size === 0) return;
  polling = true;
  try {
    const waiting = await Robot.find({ _id: { $in: [...clients.keys()] }, 'pendingCommands.0': { $exists: true } }).select('_id').lean();
    for (const { _id } of waiting) {
      const id = String(_id);
      const ws = clients.get(id);
      if (!ws) continue;
      const commands = await drainCommands(id);
      for (const c of commands) send(ws, { type: 'command', ...c });
      if (commands.length) log('Komut →', id, commands.map((c) => c.command).join(','));
    }
  } catch (e) {
    log('Komut kontrol hatası:', e.message);
  } finally {
    polling = false;
  }
}, COMMAND_POLL_MS);

// Kopmuş bağlantıları temizle
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, PING_MS);

server.listen(PORT, () => log(`AhırBot WS geçidi :${PORT}/ws`));
