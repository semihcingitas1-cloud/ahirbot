// Gerçek robot yokken uygulamayı test etmek için sahte robot.
// Kullanım:
//   API=https://ahirbot-server.vercel.app SERIAL=ATR-0001 KEY=<cihaz anahtarı> node tools/robot-simulator.js
// Seri no ve anahtar, uygulamada Ayarlar > Robot ekle sonrası gösterilir.

const API = process.env.API || 'http://localhost:4000';
const SERIAL = process.env.SERIAL;
const KEY = process.env.KEY;
const INTERVAL = Number(process.env.INTERVAL || 3000);

if (!SERIAL || !KEY) {
  console.error('SERIAL ve KEY ortam değişkenleri gerekli.');
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json', 'X-Serial': SERIAL, 'X-Device-Key': KEY };

const state = {
  status: 'idle', progress: 0, corridor: 1, corridorTotal: 2, battery: 92, tank: 10, water: 80,
  cleanedArea: 0, ammonia: 9, speed: 0, routeLengthM: 186, etaMin: 0, position: { x: 0.2, y: 0.05 },
};
let settings = null;
let taskId = null;

const post = async (path, body) => {
  const res = await fetch(API + path, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

const apply = (cmd) => {
  console.log('Komut:', cmd.command, cmd.payload ?? '');
  if (cmd.command === 'start') state.status = 'cleaning';
  if (cmd.command === 'pause') state.status = 'paused';
  if (cmd.command === 'stop') state.status = 'idle';
  if (cmd.command === 'dock') state.status = 'charging';
  if (cmd.command === 'empty') { state.status = 'emptying'; setTimeout(() => { state.tank = 0; state.status = 'idle'; }, 8000); }
};

const step = async () => {
  if (state.status === 'cleaning') {
    state.speed = settings?.speed ?? 0.8;
    state.progress = Math.min(100, state.progress + 4);
    state.position.y = Math.min(0.95, 0.05 + state.progress / 100 * 0.9);
    state.corridor = state.progress < 50 ? 1 : 2;
    state.position.x = state.corridor === 1 ? 0.2 : 0.7;
    state.tank = Math.min(100, state.tank + 2);
    state.battery = Math.max(5, state.battery - 1);
    state.cleanedArea += 15;
    state.etaMin = Math.round((100 - state.progress) / 4 * INTERVAL / 60000);
    state.ammonia = 8 + Math.round(Math.random() * 4);
  } else {
    state.speed = 0;
    if (state.status === 'charging') state.battery = Math.min(100, state.battery + 3);
  }

  const res = await post('/device/telemetry', { ...state, taskId });
  settings = res.settings;
  res.commands.forEach(apply);

  // Zamanı gelen görevi başlat
  const now = new Date().toTimeString().slice(0, 5);
  const due = res.tasks.find((t) => t.status === 'pending' && t.time <= now);
  if (due && state.status === 'idle') { taskId = due.id; state.status = 'cleaning'; state.progress = 0; console.log('Görev başladı:', due.title); }

  if (state.progress >= 100) {
    await post('/device/run', { area: 'walkway', wasteKg: 380 + Math.round(Math.random() * 120), areaM2: 420, durationMin: 35, ammonia: state.ammonia, hygiene: 88 + Math.round(Math.random() * 10), taskId });
    console.log('Tur tamamlandı, rapora yazıldı.');
    Object.assign(state, { status: 'idle', progress: 0, position: { x: 0.2, y: 0.05 } });
    taskId = null;
  }

  console.log(`${new Date().toLocaleTimeString()} ${state.status} %${state.progress} batarya %${state.battery} hazne %${state.tank}`);
};

console.log(`Sahte robot ${SERIAL} → ${API}`);
step().catch((e) => console.error(e.message));
setInterval(() => step().catch((e) => console.error(e.message)), INTERVAL);
