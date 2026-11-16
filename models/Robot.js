const mongoose = require('mongoose');

const STATUSES = ['cleaning', 'idle', 'charging', 'emptying', 'paused', 'blocked', 'error', 'offline'];
const COMMANDS = ['start', 'pause', 'stop', 'dock', 'empty', 'drive'];

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
  cameraUrl: { type: String },                 // canlı yayın adresi (varsa)
  lastSeenAt: { type: Date },
  lastAutoSlot: { type: String },               // en son yapılan otomatik tur: "YYYY-MM-DD HH:MM"

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
    cameraUrl: this.cameraUrl || null,
    lastSeenAt: this.lastSeenAt,
    settings: this.settings,
  };
};

robotSchema.statics.STATUSES = STATUSES;
robotSchema.statics.COMMANDS = COMMANDS;

module.exports = mongoose.models.Robot || mongoose.model('Robot', robotSchema);
