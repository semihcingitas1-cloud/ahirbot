const mongoose = require('mongoose');

// Vercel'de her istek yeni bir fonksiyon çağrısı olabilir; bağlantıyı global'de saklayıp tekrar kullanıyoruz.
let cached = global._mongoose || (global._mongoose = { conn: null, promise: null });

const connectDB = async () => {

  if (cached.conn) return cached.conn;

  if (!process.env.MONGO_URI) throw new Error('MONGO_URI ortam değişkeni tanımlı değil');

  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGO_URI, {
      family: 4,
      serverSelectionTimeoutMS: 10000,
      bufferCommands: false,
    }).catch((err) => {
      cached.promise = null;
      throw err;
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
};

module.exports = connectDB;
