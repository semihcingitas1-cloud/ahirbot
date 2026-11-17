const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  robot: { type: mongoose.Schema.Types.ObjectId, ref: 'Robot' },
  type: { type: String, enum: ['blocked', 'error', 'tank', 'done', 'ammonia', 'info'], default: 'info' },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  code: { type: String },                       // alarm kodu (uygulamadaki alarm rehberi): E01, M01…
  read: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
