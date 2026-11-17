const mongoose = require('mongoose');

// Çiftlik ekibi (smartHome'daki aile üyeliği gibi).
// owner: çiftliğin sahibi. Davet önce e-postaya yapılır, kullanıcı kabul edince "user" dolar.
//   manager: ahır, görev, program, ayar düzenler · worker: izler ve komut verir
const ROLES = ['manager', 'worker'];

const farmMemberSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, enum: ROLES, default: 'worker' },
  status: { type: String, enum: ['pending', 'active'], default: 'pending' },
}, { timestamps: true });

farmMemberSchema.index({ owner: 1, email: 1 }, { unique: true });

farmMemberSchema.statics.ROLES = ROLES;

module.exports = mongoose.models.FarmMember || mongoose.model('FarmMember', farmMemberSchema);
