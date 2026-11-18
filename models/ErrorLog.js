const mongoose = require('mongoose');

// Uygulamanın (ve sunucunun) yakalanmamış hataları. Aynı hata tekrar edince yeni kayıt açılmaz:
// fingerprint ile gruplanır, sayaç artar, son 20 örnek (cihaz, kullanıcı, zaman) saklanır.
const sampleSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  email: { type: String },
  fatal: { type: Boolean, default: false },
  platform: String,        // ios | android | web | server
  osVersion: String,
  appVersion: String,
  buildVersion: String,
  model: String,           // telefon modeli
  screen: String,          // hata anındaki ekran
  stack: String,
  componentStack: String,
  extra: String,
}, { _id: false });

const errorLogSchema = new mongoose.Schema({
  fingerprint: { type: String, required: true, unique: true },
  source: { type: String, enum: ['app', 'server'], default: 'app' },
  kind: { type: String, default: 'error' },      // error | render | promise | server
  name: { type: String },                         // TypeError, ReferenceError…
  message: { type: String, required: true },
  count: { type: Number, default: 0 },
  fatalCount: { type: Number, default: 0 },
  users: { type: [mongoose.Schema.Types.ObjectId], default: [] },  // etkilenen kullanıcılar (en çok 200)
  firstAt: { type: Date, default: Date.now },
  lastAt: { type: Date, default: Date.now, index: true },
  lastAppVersion: String,
  lastPlatform: String,
  resolved: { type: Boolean, default: false, index: true },
  resolvedAt: Date,
  samples: { type: [sampleSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.models.ErrorLog || mongoose.model('ErrorLog', errorLogSchema);
