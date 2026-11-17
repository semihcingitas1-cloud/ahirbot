// Bakım hatırlatıcı: robotun toplam çalışma süresine (dakika) göre.
// Her parça için "son bakımdan bu yana geçen saat" hesaplanır; aralık dolunca bildirim gider.
const ITEMS = [
  { key: 'brush', label: 'Sıyırıcı fırça', everyHours: 150, code: 'M01' },
  { key: 'tracks', label: 'Palet / tekerlek', everyHours: 400, code: 'M02' },
  { key: 'battery', label: 'Batarya kontrolü', everyHours: 1000, code: 'M03' },
];

const status = (robot) => {
  const total = robot.runMinutes || 0;
  return ITEMS.map((it) => {
    const lastAt = robot.maintenance?.[it.key]?.lastAt ?? 0;
    const usedHours = Math.max(0, (total - lastAt) / 60);
    return {
      key: it.key, label: it.label, code: it.code, everyHours: it.everyHours,
      usedHours: Math.round(usedHours * 10) / 10,
      percent: Math.min(100, Math.round((usedHours / it.everyHours) * 100)),
      due: usedHours >= it.everyHours,
      doneAt: robot.maintenance?.[it.key]?.doneAt ?? null,
    };
  });
};

module.exports = { ITEMS, status };
