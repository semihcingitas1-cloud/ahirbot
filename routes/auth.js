const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const { requireUser, sha256 } = require('../middleware/auth');
const { page, esc } = require('../utils/page');

// mqttserver/controls/user.js'teki kayıt, giriş, e-posta doğrulama ve şifre sıfırlama akışı.
// Fark: doğrulama/sıfırlama bağlantıları ayrı bir web sitesine değil, bu sunucunun kendi sayfalarına gider.

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 8;
const VERIFY_EXPIRE_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const RESET_EXPIRE_MS = 30 * 60 * 1000;

const appUrl = (req) => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
const signToken = (user) => jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

const publicUser = (u) => ({ _id: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role, plan: u.plan, herdSize: u.herdSize, isEmailVerified: u.isEmailVerified });

const sendVerificationEmail = async (req, user) => {
  const token = crypto.randomBytes(32).toString('hex');
  user.emailVerificationToken = sha256(token);
  user.emailVerificationExpire = new Date(Date.now() + VERIFY_EXPIRE_MS);
  await user.save({ validateBeforeSave: false });

  const url = `${appUrl(req)}/verify-email/${token}`;
  await sendEmail({
    to: user.email,
    subject: 'AhırBot e-posta adresinizi doğrulayın',
    html: `<p>Merhaba ${esc(user.name)},</p>
      <p>AhırBot hesabınızı etkinleştirmek için aşağıdaki bağlantıya tıklayın. Bağlantı 24 saat geçerlidir.</p>
      <p><a href="${url}">E-posta adresimi doğrula</a></p>
      <p>Bu kaydı siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>`,
  });
};

router.post('/register', async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!name || !email || !password) return res.status(400).json({ message: 'Lütfen tüm zorunlu alanları doldurun.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Geçerli bir e-posta adresi girin.' });
    if (String(password).length < MIN_PASSWORD_LENGTH) return res.status(400).json({ message: `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.` });

    const passwordHash = await bcrypt.hash(password, 10);
    let user = await User.findOne({ email });

    if (user) {
      if (user.isEmailVerified) return res.status(400).json({ message: 'Bu kullanıcı zaten kayıtlı.' });
      // Doğrulanmamış eski kayıt son istekle güncellenir (başkasının e-postasını ele geçirmeyi önler)
      user.name = name;
      user.phone = phone;
      user.password = passwordHash;
      await user.save();
    } else {
      user = await User.create({ name, email, phone, password: passwordHash });
    }

    let emailSent = true;
    try {
      await sendVerificationEmail(req, user);
    } catch (mailError) {
      emailSent = false;
      console.error('DOĞRULAMA MAİLİ HATASI:', mailError.cause?.message || mailError.message);
    }

    res.status(201).json({
      success: true,
      emailSent,
      email: user.email,
      message: emailSent
        ? 'Kayıt başarılı! Hesabınızı etkinleştirmek için e-postanıza gönderilen bağlantıya tıklayın.'
        : 'Kayıt oluşturuldu ancak doğrulama e-postası gönderilemedi. Lütfen e-postayı yeniden göndermeyi deneyin.',
    });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Bu kullanıcı zaten kayıtlı.' });
    console.error('REGISTER HATASI:', error.message);
    res.status(500).json({ message: 'Sunucu hatası oluştu.' });
  }
});

// Tarayıcıda açılan doğrulama bağlantısı
router.get('/verify-email/:token', async (req, res) => {
  try {
    const user = await User.findOne({ emailVerificationToken: sha256(req.params.token), emailVerificationExpire: { $gt: new Date() } });
    if (!user) return res.status(400).send(page('Bağlantı geçersiz', '<h1 class="err">Bağlantı geçersiz</h1><p>Doğrulama bağlantısı geçersiz veya süresi dolmuş. Uygulamadan yeni bağlantı isteyebilirsiniz.</p>'));
    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpire = undefined;
    await user.save({ validateBeforeSave: false });
    res.send(page('E-posta doğrulandı', '<h1 class="ok">E-posta doğrulandı</h1><p>Hesabınız etkin. AhırBot uygulamasına dönüp giriş yapabilirsiniz.</p>'));
  } catch (error) {
    console.error('VERIFY EMAIL HATASI:', error.message);
    res.status(500).send(page('Hata', '<h1 class="err">Bir sorun oluştu</h1><p>Lütfen daha sonra tekrar deneyin.</p>'));
  }
});

router.post('/resend-verification', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Geçerli bir e-posta adresi girin.' });

    const user = await User.findOne({ email }).select('+emailVerificationExpire');
    if (user && !user.isEmailVerified) {
      const lastSentAt = user.emailVerificationExpire ? user.emailVerificationExpire.getTime() - VERIFY_EXPIRE_MS : 0;
      if (Date.now() - lastSentAt >= RESEND_COOLDOWN_MS) await sendVerificationEmail(req, user);
    }
    // Hesabın varlığını belli etmemek için her durumda aynı cevap
    res.json({ success: true, message: 'Hesabınız doğrulanmamışsa yeni bir doğrulama e-postası gönderdik. Lütfen gelen kutunuzu kontrol edin.' });
  } catch (error) {
    console.error('RESEND VERIFICATION HATASI:', error.cause?.message || error.message);
    res.status(500).json({ message: 'E-posta gönderilemedi. Lütfen daha sonra tekrar deneyin.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { password } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !password) return res.status(400).json({ message: 'Lütfen tüm alanları doldurun.' });

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ message: 'E-posta veya şifre hatalı.' });

    if (!user.isEmailVerified) {
      return res.status(403).json({ success: false, code: 'EMAIL_NOT_VERIFIED', email: user.email, message: 'Giriş yapmadan önce e-posta adresinizi doğrulamalısınız.' });
    }

    res.json({ success: true, user: publicUser(user), token: signToken(user) });
  } catch (error) {
    console.error('LOGIN HATASI:', error.message);
    res.status(500).json({ message: 'Sunucu hatası oluştu.' });
  }
});

router.post('/forgotPassword', async (req, res) => {
  const ok = { success: true, message: 'Hesap varsa şifre sıfırlama bağlantısı e-postanıza gönderildi.' };
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user) return res.json(ok);

    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = sha256(token);
    user.resetPasswordExpire = new Date(Date.now() + RESET_EXPIRE_MS);
    await user.save({ validateBeforeSave: false });

    await sendEmail({
      to: user.email,
      subject: 'AhırBot şifre sıfırlama',
      html: `<p>Merhaba ${esc(user.name)},</p><p>Şifrenizi sıfırlamak için <a href="${appUrl(req)}/reset/${token}">buraya tıklayın</a>. Bağlantı 30 dakika geçerlidir.</p><p>Bu isteği siz yapmadıysanız e-postayı yok sayın.</p>`,
    });
    res.json(ok);
  } catch (error) {
    console.error('FORGOT PASSWORD HATASI:', error.cause?.message || error.message);
    res.status(500).json({ message: 'E-posta gönderilemedi. Lütfen daha sonra tekrar deneyin.' });
  }
});

// Tarayıcıda açılan sıfırlama formu
router.get('/reset/:token', (req, res) => {
  const t = esc(req.params.token);
  res.send(page('Şifre sıfırla', `<h1>Yeni şifre belirleyin</h1>
    <form method="post" action="/reset/${t}">
      <input type="password" name="password" placeholder="Yeni şifre (en az 8 karakter)" minlength="8" required>
      <input type="password" name="confirm" placeholder="Yeni şifre tekrar" minlength="8" required>
      <button type="submit">Şifreyi kaydet</button>
    </form>`));
});

router.post('/reset/:token', async (req, res) => {
  const fromForm = req.is('application/x-www-form-urlencoded');
  const fail = (status, msg) => (fromForm ? res.status(status).send(page('Hata', `<h1 class="err">Olmadı</h1><p>${esc(msg)}</p>`)) : res.status(status).json({ message: msg }));
  try {
    const { password, confirm } = req.body;
    if (!password || String(password).length < MIN_PASSWORD_LENGTH) return fail(400, `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`);
    if (fromForm && password !== confirm) return fail(400, 'Şifreler eşleşmiyor.');

    const user = await User.findOne({ resetPasswordToken: sha256(req.params.token), resetPasswordExpire: { $gt: new Date() } });
    if (!user) return fail(400, 'Bağlantı geçersiz veya süresi dolmuş.');

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    user.isEmailVerified = true; // bağlantı e-postaya gittiği için posta kutusu kanıtlanmış olur
    await user.save();

    if (fromForm) return res.send(page('Şifre değişti', '<h1 class="ok">Şifreniz değişti</h1><p>Uygulamaya dönüp yeni şifrenizle giriş yapabilirsiniz.</p>'));
    res.json({ success: true, user: publicUser(user), token: signToken(user) });
  } catch (error) {
    console.error('RESET PASSWORD HATASI:', error.message);
    fail(500, 'Sunucu hatası oluştu.');
  }
});

router.get('/profile', requireUser, (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
});

router.put('/profile', requireUser, async (req, res) => {
  const { name, phone, herdSize } = req.body;
  if (name) req.user.name = name;
  if (phone !== undefined) req.user.phone = phone;
  if (herdSize !== undefined) req.user.herdSize = Number(herdSize) || 0;
  await req.user.save();
  res.json({ success: true, user: publicUser(req.user) });
});

module.exports = router;
