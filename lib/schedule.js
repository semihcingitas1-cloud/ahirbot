// Otomatik temizlik programından günün tur saatlerini üretir.
// Vercel UTC çalışır; saatler çiftliğin saat dilimine göre hesaplanır.

const TZ = process.env.TZ_FARM || 'Europe/Istanbul';

const nowLocal = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};

const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const MILKING_WINDOW_MIN = 60;

// ["06:00", "09:00", ...] — sessiz gece (22:00-06:00) ve sağım saatleri (sağım başlangıcından 60 dk) atlanır
const programSlots = (p) => {
  if (!p?.enabled) return [];
  const from = toMin(p.from || '06:00');
  const to = toMin(p.to || '24:00');
  const step = Math.max(1, Number(p.everyHours) || 3) * 60;
  const milking = (p.milkingTimes?.length ? p.milkingTimes : ['06:00', '18:00']).map(toMin);
  const slots = [];
  for (let m = from; m < to && m < 24 * 60; m += step) {
    if (p.quietNight && (m >= 22 * 60 || m < 6 * 60)) continue;
    if (p.waitDuringMilking && milking.some((s) => m >= s && m < s + MILKING_WINDOW_MIN)) continue;
    slots.push(toTime(m));
  }
  return slots;
};

const isValidTime = (t, allow24) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t) || (allow24 && t === '24:00');

module.exports = { nowLocal, programSlots, isValidTime };
