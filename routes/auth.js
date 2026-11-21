const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const { requireUser, sha256 } = require('../middleware/auth');
const { page, esc } = require('../utils/page');
const { deleteUserData } = require('../lib/account');
const { emailTemplate } = require('../utils/emailTemplate');

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

const publicUser = (u) => ({ _id: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role, herdSize: u.herdSize, isEmailVerified: u.isEmailVerified });

const sendVerificationEmail = async (req, user) => {
  const token = crypto.randomBytes(32).toString('hex');
  user.emailVerificationToken = sha256(token);
  user.emailVerificationExpire = new Date(Date.now() + VERIFY_EXPIRE_MS);
  await user.save({ validateBeforeSave: false });

  const url = `${appUrl(req)}/verify-email/${token}`;
  await sendEmail({
    to: user.email,
    subject: 'AhırBot e-posta adresinizi doğrulayın',
    ...emailTemplate({
      preheader: 'Hesabınızı etkinleştirmek için e-posta adresinizi doğrulayın.',
      title: 'E-posta adresinizi doğrulayın',
      greeting: `Merhaba ${user.name},`,
      paragraphs: ['AhırBot hesabınızı etkinleştirmek için aşağıdaki butona dokunun. Bağlantı <b>24 saat</b> geçerlidir.'],
      button: { url, label: 'E-posta adresimi doğrula' },
      note: 'Bu kaydı siz yapmadıysanız bu e-postayı yok sayabilirsiniz; hesap etkinleşmez.',
    }),
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

    if (user.disabled) return res.status(403).json({ success: false, code: 'ACCOUNT_DISABLED', message: 'Hesabınız askıya alınmış. Destek ile iletişime geçin.' });

    if (!user.isEmailVerified) {
      return res.status(403).json({ success: false, code: 'EMAIL_NOT_VERIFIED', email: user.email, message: 'Giriş yapmadan önce e-posta adresinizi doğrulamalısınız.' });
    }

    User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).catch(() => {});
    res.json({ success: true, user: publicUser(user), token: signToken(user) });
  } catch (error) {
    console.error('LOGIN HATASI:', error.message);
    res.status(500).json({ message: 'Sunucu hatası oluştu.' });
  }
});

// Şifremi unuttum: e-postaya hem 6 haneli kod (uygulamada girilir) hem de tarayıcı bağlantısı gider.
// Kod 30 dk geçerli, 5 hatalı denemede iptal olur. Aynı adrese dakikada en çok bir e-posta gider.
const RESET_CODE_MAX_ATTEMPTS = 5;
const codeHash = (user, code) => sha256(`${user._id}:${String(code).trim()}`);

router.post('/forgotPassword', async (req, res) => {
  const ok = { success: true, message: 'Bu e-postayla bir hesap varsa 6 haneli kod gönderdik. Gelen kutunuzu (ve spam klasörünü) kontrol edin.' };
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Geçerli bir e-posta adresi girin.' });
    const user = await User.findOne({ email }).select('+resetPasswordExpire');
    if (!user || user.disabled) return res.json(ok);

    const lastSentAt = user.resetPasswordExpire ? user.resetPasswordExpire.getTime() - RESET_EXPIRE_MS : 0;
    if (Date.now() - lastSentAt < RESEND_COOLDOWN_MS) return res.json(ok);

    const token = crypto.randomBytes(32).toString('hex');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    user.resetPasswordToken = sha256(token);
    user.resetPasswordExpire = new Date(Date.now() + RESET_EXPIRE_MS);
    user.resetCodeHash = codeHash(user, code);
    user.resetCodeAttempts = 0;
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${appUrl(req)}/reset/${token}`;
    await sendEmail({
      to: user.email,
      subject: `AhırBot şifre sıfırlama kodu: ${code}`,
      ...emailTemplate({
        preheader: `Şifre sıfırlama kodunuz: ${code}. 30 dakika geçerlidir.`,
        title: 'Şifre sıfırlama kodunuz',
        greeting: `Merhaba ${user.name},`,
        paragraphs: ['Bu kodu AhırBot uygulamasındaki <b>"Şifremi unuttum"</b> ekranına girin. Kod <b>30 dakika</b> geçerlidir.'],
        code,
        after: [`Uygulama elinizde değilse <a href="${resetUrl}" style="color:#1b7a52;font-weight:600">buradan tarayıcıda sıfırlayabilirsiniz</a>.`],
        note: 'Bu isteği siz yapmadıysanız e-postayı yok sayın; şifreniz değişmez.',
      }),
    });
    res.json(ok);
  } catch (error) {
    console.error('FORGOT PASSWORD HATASI:', error.cause?.message || error.message);
    res.status(500).json({ message: 'E-posta gönderilemedi. Lütfen daha sonra tekrar deneyin.' });
  }
});

// Kodu kontrol eder. consume=false: sadece doğrular (uygulamada "yeni şifre" adımına geçmek için)
const checkResetCode = async (emailRaw, code) => {
  const email = String(emailRaw || '').trim().toLowerCase();
  if (!/^\d{6}$/.test(String(code || '').trim())) return { status: 400, body: { code: 'INVALID_CODE', message: 'Kod 6 haneli olmalı.' } };
  const user = await User.findOne({ email }).select('+resetCodeHash +resetCodeAttempts +resetPasswordExpire');
  if (!user || !user.resetCodeHash || !user.resetPasswordExpire || user.resetPasswordExpire < new Date()) {
    return { status: 400, body: { code: 'CODE_EXPIRED', message: 'Kodun süresi dolmuş ya da hiç istenmemiş. Yeni kod isteyin.' } };
  }
  if (user.resetCodeHash !== codeHash(user, code)) {
    const attempts = (user.resetCodeAttempts || 0) + 1;
    const left = RESET_CODE_MAX_ATTEMPTS - attempts;
    if (left <= 0) {
      await User.updateOne({ _id: user._id }, { $unset: { resetCodeHash: 1 }, $set: { resetCodeAttempts: attempts } });
      return { status: 400, body: { code: 'TOO_MANY_ATTEMPTS', message: 'Çok fazla hatalı deneme. Yeni kod isteyin.' } };
    }
    await User.updateOne({ _id: user._id }, { $set: { resetCodeAttempts: attempts } });
    return { status: 400, body: { code: 'INVALID_CODE', attemptsLeft: left, message: `Kod hatalı. ${left} deneme hakkınız kaldı.` } };
  }
  return { user };
};

router.post('/reset-password/check', async (req, res) => {
  const r = await checkResetCode(req.body.email, req.body.code);
  if (!r.user) return res.status(r.status).json(r.body);
  res.json({ success: true });
});

// Uygulama içi sıfırlama: { email, code, password } → yeni şifre kaydedilir ve oturum açılır
router.post('/reset-password/code', async (req, res) => {
  const { password } = req.body;
  if (!password || String(password).length < MIN_PASSWORD_LENGTH) return res.status(400).json({ message: `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.` });
  const r = await checkResetCode(req.body.email, req.body.code);
  if (!r.user) return res.status(r.status).json(r.body);
  const user = r.user;

  user.password = await bcrypt.hash(String(password), 10);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  user.resetCodeHash = undefined;
  user.resetCodeAttempts = 0;
  user.isEmailVerified = true; // kod e-postaya gittiği için posta kutusu kanıtlanmış olur
  await user.save();

  if (user.disabled) return res.status(403).json({ success: false, code: 'ACCOUNT_DISABLED', message: 'Şifreniz değişti ancak hesabınız askıya alınmış. Destek ile iletişime geçin.' });
  User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).catch(() => {});
  res.json({ success: true, user: publicUser(user), token: signToken(user) });
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
    user.resetCodeHash = undefined;
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

// ─── Hesap silme ───
// Uygulamadan: DELETE /account  { password }   (Ayarlar > Hesabı sil)
// Tarayıcıdan: /delete-account  (Google Play "hesap silme bağlantısı" olarak bu adres verilir)
const sendDeletedEmail = (info) => sendEmail({
  to: info.email,
  subject: 'AhırBot hesabınız silindi',
  ...emailTemplate({
    preheader: 'Hesabınız ve tüm verileriniz kalıcı olarak silindi.',
    title: 'Hesabınız silindi',
    greeting: `Merhaba ${info.name},`,
    paragraphs: ['AhırBot hesabınız ve çiftliğinize ait tüm veriler (robotlar, ahırlar, görevler, tur geçmişi, bildirimler, ekip) kalıcı olarak silindi.'],
    note: 'Bu işlemi siz yapmadıysanız hemen bu e-postayı yanıtlayın.',
    tone: 'danger',
  }),
}).catch((e) => console.error('HESAP SİLME MAİLİ HATASI:', e.cause?.message || e.message));

router.delete('/account', requireUser, async (req, res) => {
  const password = String(req.body?.password || '');
  if (!password) return res.status(400).json({ message: 'Hesabı silmek için şifrenizi girin.' });
  const user = await User.findById(req.user._id).select('+password');
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ code: 'WRONG_PASSWORD', message: 'Şifre hatalı.' });

  const info = await deleteUserData(user._id);
  if (info) await sendDeletedEmail(info);
  res.json({ success: true, message: 'Hesabınız ve tüm verileriniz silindi.', deleted: info?.summary });
});

const deleteForm = (msg = '') => page('Hesabı sil', `<h1>Hesabı sil</h1>
  <p>AhırBot hesabınız ve çiftliğinize ait <b>tüm veriler</b> (robotlar, ahırlar, görevler, tur geçmişi, bildirimler, ekip) kalıcı olarak silinir. Bu işlem geri alınamaz.</p>
  ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
  <form method="post" action="/delete-account">
    <input type="email" name="email" placeholder="E-posta" autocomplete="username" required>
    <input type="password" name="password" placeholder="Şifre" autocomplete="current-password" required>
    <label style="display:flex;gap:8px;align-items:flex-start;text-align:left;color:#6b7c73;font-size:14px;margin:8px 0"><input type="checkbox" name="confirm" value="1" required style="width:auto;height:auto;margin-top:3px">Hesabımın ve tüm verilerimin kalıcı olarak silineceğini anlıyorum.</label>
    <button type="submit" style="background:#e5534b">Hesabımı kalıcı olarak sil</button>
  </form>`);

router.get('/delete-account', (req, res) => res.send(deleteForm()));

const deleteFails = new Map();
router.post('/delete-account', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password || req.body.confirm !== '1') return res.status(400).send(deleteForm('E-posta, şifre ve onay kutusu gerekli.'));

  const f = deleteFails.get(email);
  if (f && f.n >= 5 && Date.now() - f.at < 15 * 60 * 1000) return res.status(429).send(deleteForm('Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.'));

  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await bcrypt.compare(password, user.password))) {
    deleteFails.set(email, { n: (f ? f.n : 0) + 1, at: Date.now() });
    await new Promise((r) => setTimeout(r, 700));
    return res.status(401).send(deleteForm('E-posta veya şifre hatalı.'));
  }
  deleteFails.delete(email);
  const info = await deleteUserData(user._id);
  if (info) await sendDeletedEmail(info);
  res.send(page('Hesap silindi', '<h1 class="ok">Hesabınız silindi</h1><p>Hesabınız ve çiftliğinize ait tüm veriler kalıcı olarak silindi. Robotlarınızı başka bir hesaba eklemek için robotu sıfırlayıp yeniden eşleştirin.</p>'));
});

module.exports = router;
