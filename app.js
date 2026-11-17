require('dotenv').config();
const express = require('express');
const cors = require('cors');

const connectDB = require('./lib/db');
const auth = require('./routes/auth');
const farm = require('./routes/farm');
const device = require('./routes/device');
const team = require('./routes/team');
const admin = require('./routes/admin');
const homePage = require('./utils/homePage');
const sendEmail = require('./utils/sendEmail');
const { version } = require('./package.json');

if (!process.env.JWT_SECRET) console.error('UYARI: JWT_SECRET tanımlı değil, giriş çalışmaz.');

const app = express();

app.set('trust proxy', 1);
app.use(cors()); // mobil uygulama ve robot farklı yerlerden bağlanır; kimlik doğrulama token ile
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// SMTP ayarlarını dener; şifre gibi bilgileri göstermeden sorunun türünü söyler
const checkMail = async () => {
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter((k) => !process.env[k]);
  if (missing.length) return { ok: false, reason: `Vercel'de şu değişkenler eksik: ${missing.join(', ')}. Ekledikten sonra yeniden deploy edin.` };
  try {
    await Promise.race([sendEmail.verify(), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('zaman aşımı'), { code: 'ETIMEDOUT' })), 8000))]);
    return { ok: true };
  } catch (err) {
    console.error('SMTP TEST HATASI:', err.code, err.responseCode, err.message);
    if (err.code === 'EAUTH' || err.responseCode === 535) return { ok: false, reason: 'Kullanıcı adı veya şifre reddedildi. Gmail kullanıyorsanız normal şifre çalışmaz: Google hesabında 2 adımlı doğrulamayı açıp "Uygulama şifresi" oluşturun ve SMTP_PASS\'a onu (boşluksuz) yazın.' };
    if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'EDNS', 'ENOTFOUND'].includes(err.code)) return { ok: false, reason: `E-posta sunucusuna bağlanılamadı (${err.code}). SMTP_HOST ve SMTP_PORT'u kontrol edin (Gmail: smtp.gmail.com ve 465).` };
    return { ok: false, reason: `SMTP hatası: ${String(err.message).slice(0, 160)}` };
  }
};

app.get('/', async (req, res) => {
  let dbOk = false;
  try { await connectDB(); dbOk = true; } catch { /* sayfada "Bağlantı yok" görünür */ }
  const mail = await checkMail();
  res.send(homePage({ dbOk, version, mail }));
});
app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/', admin.pages);   // /admin yönetici paneli sayfaları

// Her istekten önce (önbellekli) veritabanı bağlantısı
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('MongoDB bağlantı hatası:', error.message);
    res.status(503).json({ message: 'Veritabanına bağlanılamadı.' });
  }
});

app.use('/admin/api', admin.api);
app.use('/', auth);
app.use('/', device);
app.use('/', team);
app.use('/', farm);

app.use((req, res) => res.status(404).json({ message: 'Bulunamadı' }));

// Express 5 async hataları buraya düşer
app.use((err, req, res, next) => {
  console.error('SUNUCU HATASI:', err.message);
  res.status(500).json({ message: 'Sunucu hatası oluştu.' });
});

module.exports = app;
