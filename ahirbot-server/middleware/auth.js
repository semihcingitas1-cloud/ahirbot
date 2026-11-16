const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const User = require('../models/User');
const Robot = require('../models/Robot');

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
    req.user = user;
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

module.exports = { requireUser, requireDevice, sha256 };
