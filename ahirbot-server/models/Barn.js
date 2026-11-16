const mongoose = require('mongoose');

const barnSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },       // kısa ad: "Ahır A"
  fullName: { type: String, trim: true },                    // "Süt Ahırı A"
  heads: { type: Number, default: 0 },                       // hayvan sayısı
  corridors: { type: Number, default: 2 },
}, { timestamps: true });

barnSchema.set('toJSON', {
  transform: (_, r) => ({ id: String(r._id), name: r.name, fullName: r.fullName || r.name, heads: r.heads, corridors: r.corridors }),
});

module.exports = mongoose.models.Barn || mongoose.model('Barn', barnSchema);
