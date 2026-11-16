require('dotenv').config();
const express = require('express');
const cors = require('cors');

const connectDB = require('./lib/db');
const auth = require('./routes/auth');
const farm = require('./routes/farm');
const device = require('./routes/device');

if (!process.env.JWT_SECRET) console.error('UYARI: JWT_SECRET tanımlı değil, giriş çalışmaz.');

const app = express();

app.set('trust proxy', 1);
app.use(cors()); // mobil uygulama ve robot farklı yerlerden bağlanır; kimlik doğrulama token ile
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => res.send('AhırBot API çalışıyor'));
app.get('/health', (req, res) => res.json({ ok: true }));

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

app.use('/', auth);
app.use('/', device);
app.use('/', farm);

app.use((req, res) => res.status(404).json({ message: 'Bulunamadı' }));

// Express 5 async hataları buraya düşer
app.use((err, req, res, next) => {
  console.error('SUNUCU HATASI:', err.message);
  res.status(500).json({ message: 'Sunucu hatası oluştu.' });
});

module.exports = app;
