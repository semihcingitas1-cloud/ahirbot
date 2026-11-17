const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const User = require('../models/User');
const Robot = require('../models/Robot');
const FarmMember = require('../models/FarmMember');

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

// Uygulama istekleri: "Authorization: Bearer <token>" (mqttserver/middleware/auth.js ile aynı mantık)
const requireUser = async (req, res, next) => {

  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ success: false, message: 'Erişim için oturum açınız.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ success: false, message: 'Kullanıcı bulunamadı.' });
    if (user.disabled) return res.status(403).json({ success: false, code: 'ACCOUNT_DISABLED', message: 'Hesabınız askıya alınmış. Destek ile iletişime geçin.' });
    req.user = user;

    // Çiftlik bağlamı: kullanıcı başka bir çiftliğin ekibindeyse o çiftliğin verisiyle çalışır
    const membership = await FarmMember.findOne({ user: user._id, status: 'active' });
    if (membership) {
      const owner = await User.findById(membership.owner);
      if (owner) {
        req.farmId = owner._id;
        req.farmOwner = owner;
        req.farmRole = membership.role;
        return next();
      }
    }
    req.farmId = user._id;
    req.farmOwner = user;
    req.farmRole = 'owner';
    next();
  } catch (error) {
    const message = error.name === 'TokenExpiredError' ? 'Oturumunuzun süresi dolmuş. Lütfen tekrar giriş yapın.' : 'Token geçersiz. Lütfen tekrar giriş yapın.';
    return res.status(401).json({ success: false, message });
  }
};

// Robot istekleri: "X-Device-Key: <anahtar>" + "X-Serial: <seri no>"
const requireDevice = async (req, res, next) => {

  const key = req.headers['x-device-key'];
  const serial = req.headers['x-serial'];

  if (!key || !serial) return res.status(401).json({ success: false, message: 'Cihaz anahtarı eksik.' });

  const robot = await Robot.findOne({ serialNumber: serial }).select('+deviceKeyHash');
  if (!robot || robot.deviceKeyHash !== sha256(key)) {
    return res.status(401).json({ success: false, message: 'Cihaz doğrulanamadı.' });
  }

  req.robot = robot;
  next();
};

// Rol kontrolü: requireRole('owner') ya da requireRole('owner', 'manager')
const ROLE_LABEL = { owner: 'çiftlik sahibi', manager: 'yönetici' };
const requireRole = (...roles) => (req, res, next) => {
  if (roles.includes(req.farmRole)) return next();
  return res.status(403).json({ success: false, message: `Bu işlem için ${roles.map((r) => ROLE_LABEL[r] || r).join(' veya ')} yetkisi gerekir.` });
};

// ─── Yönetici paneli (/admin) ───
// Yönetici: User.role === 'admin' ya da e-postası ADMIN_EMAILS ortam değişkeninde olan kullanıcı.
// Panel token'ı uygulama token'ından ayrıdır (adm: true, 8 saat); uygulama token'ı panele giremez.
const adminEmails = () => String(process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const isAdmin = (user) => !!user && !user.disabled && (user.role === 'admin' || adminEmails().includes(user.email));

const requireAdmin = async (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ message: 'Yönetici girişi gerekli.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.adm) return res.status(401).json({ message: 'Yönetici girişi gerekli.' });
    const user = await User.findById(decoded.id);
    if (!isAdmin(user)) return res.status(403).json({ message: 'Yönetici yetkiniz yok.' });
    req.admin = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: error.name === 'TokenExpiredError' ? 'Oturum süresi doldu, tekrar giriş yapın.' : 'Geçersiz oturum.' });
  }
};

module.exports = { requireUser, requireDevice, requireRole, requireAdmin, isAdmin, sha256 };
