const mongoose = require('mongoose');

// mqttserver/models/user.js'ten sadeleştirildi: ev/oda, sipariş ve AI alanları çıkarıldı,
// çiftlik bilgisi ve otomatik temizlik programı eklendi.
const userSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'İsim zorunludur'], trim: true },
  email: { type: String, required: [true, 'E-posta zorunludur'], unique: true, lowercase: true, trim: true },
  phone: { type: String, trim: true },
  password: { type: String, required: [true, 'Şifre zorunludur'], select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },

  isEmailVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String, select: false },
  emailVerificationExpire: { type: Date, select: false },
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpire: { type: Date, select: false },

  herdSize: { type: Number, default: 0 },

  // Expo push token'ları (her telefon kurulumu için bir tane)
  pushTokens: {
    type: [{
      token: { type: String, required: true },
      platform: { type: String },
      installationId: { type: String },
      deviceName: { type: String },
      updatedAt: { type: Date, default: Date.now },
    }],
    default: [],
    select: false,
  },

  // Ekran 5'teki "Otomatik program" kartı
  autoProgram: {
    enabled: { type: Boolean, default: true },
    everyHours: { type: Number, default: 3 },
    barnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Barn' },
    from: { type: String, default: '06:00' },
    to: { type: String, default: '24:00' },
    waitDuringMilking: { type: Boolean, default: true },
    quietNight: { type: Boolean, default: true },
    milkingTimes: { type: [String], default: ['06:00', '18:00'] },
  },
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
