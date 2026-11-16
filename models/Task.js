const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  robot: { type: mongoose.Schema.Types.ObjectId, ref: 'Robot', required: true },
  barn: { type: mongoose.Schema.Types.ObjectId, ref: 'Barn' },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // YYYY-MM-DD
  time: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  title: { type: String, required: true, trim: true },
  mode: { type: String, default: 'Sıyırma' },
  status: { type: String, enum: ['pending', 'running', 'done', 'cancelled'], default: 'pending' },
  progress: { type: Number, default: 0 },
}, { timestamps: true });

taskSchema.index({ owner: 1, date: 1 });

module.exports = mongoose.models.Task || mongoose.model('Task', taskSchema);
