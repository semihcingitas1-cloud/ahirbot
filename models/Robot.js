const mongoose = require('mongoose');

const STATUSES = ['cleaning', 'idle', 'charging', 'emptying', 'paused', 'blocked', 'error', 'offline'];
const COMMANDS = ['start', 'pause', 'stop', 'dock', 'empty', 'drive', 'ota'];

const robotSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  barn: { type: mongoose.Schema.Types.ObjectId, ref: 'Barn' },
  name: { type: String, required: true, trim: true },           // "ATR-01"
  serialNumber: { type: String, required: true, unique: true, trim: true },
  deviceKeyHash: { type: String, required: true, select: false }, // robotun sunucuya kendini tanıttığı anahtarın hash'i

  // Robotun en son bildirdiği durum (POST /device/telemetry)
  status: { type: String, enum: STATUSES, default: 'offline' },
  progress: { type: Number, default: 0 },
  corridor: { type: Number, default: 0 },
  corridorTotal: { type: Number, default: 2 },
  battery: { type: Number, default: 0 },
  tank: { type: Number, default: 0 },          // atık haznesi doluluğu %
  tankCapacityL: { type: Number, default: 750 },
  water: { type: Number, default: 0 },         // su tankı %
  waterCapacityL: { type: Number, default: 200 },
  cleanedArea: { type: Number, default: 0 },   // bugünkü m²
  ammonia: { type: Number, default: 0 },       // ppm
  speed: { type: Number, default: 0 },
  routeLengthM: { type: Number, default: 0 },
  etaMin: { type: Number, default: 0 },
  position: { x: { type: Number, default: 0 }, y: { type: Number, default: 0 } },
  lastSeenAt: { type: Date },
  firmwareVersion: { type: String },
  runMinutes: { type: Number, default: 0 },     // toplam çalışma süresi (bakım hatırlatıcı için)
  maintenance: {                                // son bakım anındaki runMinutes
    brush: { lastAt: { type: Number, default: 0 }, doneAt: Date, notified: { type: Boolean, default: false } },
    tracks: { lastAt: { type: Number, default: 0 }, doneAt: Date, notified: { type: Boolean, default: false } },
    battery: { lastAt: { type: Number, default: 0 }, doneAt: Date, notified: { type: Boolean, default: false } },
  },
  lastAutoSlot: { type: String },
  // Son yazılım güncellemesinin durumu (yönetici paneli ve uygulama gösterir)
  //   queued: kuyrukta · sent: robot komutu aldı · downloading: indiriyor · success / failed / no_update
  ota: {
    state: { type: String, enum: ['queued', 'sent', 'downloading', 'success', 'failed', 'no_update'] },
    version: String,        // hedef sürüm
    from: String,           // güncelleme öncesi sürüm
    firmwareId: String,     // GridFS dosyası (panelden yüklendiyse)
    url: String,            // harici adres (elle girildiyse)
    detail: String,         // hata açıklaması
    at: Date,
  },               // en son yapılan otomatik tur: "YYYY-MM-DD HH:MM"

  settings: {
    mode: { type: String, enum: ['scrape', 'vacuum', 'wash', 'disinfect'], default: 'scrape' },
    speed: { type: Number, min: 0.3, max: 1.5, default: 0.8 },
    pressure: { type: Number, min: 0, max: 100, default: 55 },
    slowForAnimals: { type: Boolean, default: true },
  },

  // Uygulamadan gelen, robotun henüz almadığı komutlar
  pendingCommands: [{
    command: { type: String, enum: COMMANDS },
    payload: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

// 2 dakikadır sinyal yoksa çevrimdışı say
robotSchema.virtual('liveStatus').get(function () {
  if (!this.lastSeenAt || Date.now() - this.lastSeenAt.getTime() > 2 * 60 * 1000) return 'offline';
  return this.status;
});

robotSchema.methods.toApp = function () {
  const barn = this.barn && this.barn.name ? this.barn : null;
  return {
    id: String(this._id),
    name: this.name,
    serialNumber: this.serialNumber,
    barnId: barn ? String(barn._id) : this.barn ? String(this.barn) : null,
    barnName: barn ? (barn.fullName || barn.name) : '',
    status: this.liveStatus,
    progress: this.progress, corridor: this.corridor, corridorTotal: this.corridorTotal,
    battery: this.battery, tank: this.tank, tankCapacityL: this.tankCapacityL,
    water: this.water, waterCapacityL: this.waterCapacityL,
    cleanedArea: this.cleanedArea, ammonia: this.ammonia, speed: this.speed,
    routeLengthM: this.routeLengthM, etaMin: this.etaMin,
    position: { x: this.position?.x ?? 0, y: this.position?.y ?? 0 },
    lastSeenAt: this.lastSeenAt,
    firmwareVersion: this.firmwareVersion || null,
    runHours: Math.round(((this.runMinutes || 0) / 60) * 10) / 10,
    maintenance: require('../lib/maintenance').status(this),
    settings: this.settings,
    ota: this.ota?.state ? { state: this.ota.state, version: this.ota.version || null, detail: this.ota.detail || null, at: this.ota.at } : null,
  };
};

robotSchema.statics.STATUSES = STATUSES;
robotSchema.statics.COMMANDS = COMMANDS;

module.exports = mongoose.models.Robot || mongoose.model('Robot', robotSchema);
