const mongoose = require('mongoose');

const barnSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },       // kısa ad: "Ahır A"
  fullName: { type: String, trim: true },                    // "Süt Ahırı A"
  heads: { type: Number, default: 0 },                       // hayvan sayısı
  // Ahır planı (uygulamadaki plan düzenleyici). Konumlar 0-1 arası (sol üst = 0,0)
  layout: {
    corridors: { type: Number, min: 1, max: 4, default: 2 },   // yürüme koridoru sayısı
    stalls: { type: Number, min: 2, max: 20, default: 8 },      // bir sıradaki bölme sayısı
    dock: { x: { type: Number, default: 0.25 }, y: { type: Number, default: 0.04 } },  // şarj istasyonu
    dump: { x: { type: Number, default: 0.5 }, y: { type: Number, default: 0.97 } },   // gübre kanalı / boşaltma
  },
}, { timestamps: true });

barnSchema.methods.layoutToApp = function () {
  const l = this.layout || {};
  return {
    corridors: l.corridors ?? 2,
    stalls: l.stalls ?? 8,
    dock: { x: l.dock?.x ?? 0.25, y: l.dock?.y ?? 0.04 },
    dump: { x: l.dump?.x ?? 0.5, y: l.dump?.y ?? 0.97 },
  };
};

barnSchema.set('toJSON', {
  transform: (doc, r) => ({ id: String(r._id), name: r.name, fullName: r.fullName || r.name, heads: r.heads, layout: doc.layoutToApp() }),
});

module.exports = mongoose.models.Barn || mongoose.model('Barn', barnSchema);
