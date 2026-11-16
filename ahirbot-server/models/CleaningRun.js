const mongoose = require('mongoose');

// Robotun tamamladığı her tur; raporlar bunlardan hesaplanır
const runSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  robot: { type: mongoose.Schema.Types.ObjectId, ref: 'Robot', required: true },
  barn: { type: mongoose.Schema.Types.ObjectId, ref: 'Barn' },
  area: { type: String, enum: ['walkway', 'milking', 'calf', 'other'], default: 'walkway' },
  wasteKg: { type: Number, default: 0 },
  areaM2: { type: Number, default: 0 },
  durationMin: { type: Number, default: 0 },
  ammonia: { type: Number },      // tur sonundaki ortalama ppm
  hygiene: { type: Number },      // 0-100, robotun kamerasından hesaplanan temizlik skoru (varsa)
  finishedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

module.exports = mongoose.models.CleaningRun || mongoose.model('CleaningRun', runSchema);
