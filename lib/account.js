const mongoose = require('mongoose');

const User = require('../models/User');
const Robot = require('../models/Robot');
const Barn = require('../models/Barn');
const Task = require('../models/Task');
const CleaningRun = require('../models/CleaningRun');
const Notification = require('../models/Notification');
const FarmMember = require('../models/FarmMember');
const ErrorLog = require('../models/ErrorLog');

// ─────────────────────────────────────────────────────────────
// Hesap silme (App Store / Google Play zorunluluğu).
// Kullanıcının kendi çiftliğine ait her şey silinir: robotlar (seri numaraları boşa çıkar),
// ahırlar, görevler, tur geçmişi, bildirimler, ekibi ve davetleri.
// Başka bir çiftliğin ekibindeyse sadece üyeliği silinir; o çiftliğin verisine dokunulmaz.
// Hata kayıtlarında kullanıcı bağlantısı kaldırılır (kayıt anonim kalır).
// ─────────────────────────────────────────────────────────────

const deleteUserData = async (userId) => {
  const id = new mongoose.Types.ObjectId(String(userId));
  const user = await User.findById(id);
  if (!user) return null;

  const robots = await Robot.find({ owner: id }).select('_id serialNumber').lean();
  const robotIds = robots.map((r) => r._id);

  const results = await Promise.all([
    Task.deleteMany({ $or: [{ owner: id }, { robot: { $in: robotIds } }] }),
    CleaningRun.deleteMany({ $or: [{ owner: id }, { robot: { $in: robotIds } }] }),
    Notification.deleteMany({ $or: [{ owner: id }, { robot: { $in: robotIds } }] }),
    Barn.deleteMany({ owner: id }),
    FarmMember.deleteMany({ $or: [{ owner: id }, { user: id }, { email: user.email }] }),
    ErrorLog.updateMany({ 'samples.user': id }, { $set: { 'samples.$[s].user': null, 'samples.$[s].email': null } }, { arrayFilters: [{ 's.user': id }] }),
  ]);
  await Robot.deleteMany({ owner: id });
  await User.deleteOne({ _id: id });

  const summary = { robots: robots.length, tasks: results[0].deletedCount, runs: results[1].deletedCount, notifications: results[2].deletedCount, barns: results[3].deletedCount, members: results[4].deletedCount };
  console.log(`HESAP SİLİNDİ ${String(id)}: ${JSON.stringify(summary)}`);
  return { email: user.email, name: user.name, summary };
};

module.exports = { deleteUserData };
