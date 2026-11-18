const crypto = require('crypto');
const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────
// ESP32 yazılım dosyaları (.bin) MongoDB GridFS'te saklanır ("firmware.files" + "firmware.chunks").
// Ek servis/ücret yok; Vercel'in dosya sistemi kalıcı olmadığı için diske yazılmaz.
// Sınır: Vercel istek/cevap gövdesi en çok 4,5 MB → .bin en çok 4 MB (ESP32 uygulama bölümü zaten ~1,9 MB).
// ─────────────────────────────────────────────────────────────

const MAX_BYTES = 4 * 1024 * 1024;
const VERSION_RE = /^[\w.+-]{1,32}$/;
const TAG = Buffer.from('AHIRBOT_FW=');

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'firmware' });
const files = () => mongoose.connection.db.collection('firmware.files');
const toId = (id) => (mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(String(id)) : null);

// ESP32 uygulama imajı 0xE9 ile başlar. AhırBot yazılımı içine "AHIRBOT_FW=v0.5.0" etiketi gömer:
// sürüm buradan otomatik okunur (yanlış dosya yüklemeyi de önler).
const inspect = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 1024) return { ok: false, reason: 'Dosya boş ya da çok küçük.' };
  if (buf.length > MAX_BYTES) return { ok: false, reason: `Dosya çok büyük (${(buf.length / 1048576).toFixed(1)} MB). En çok 4 MB olabilir.` };
  if (buf[0] !== 0xe9) return { ok: false, reason: 'Bu bir ESP32 yazılım dosyası (.bin) değil. Arduino’da Taslak > Derlenmiş Binary’i Dışa Aktar ile çıkan "…ino.bin" dosyasını seçin (bootloader/partitions/merged değil).' };
  const i = buf.indexOf(TAG);
  let version = null;
  if (i >= 0) {
    const end = buf.indexOf(0, i);
    const v = buf.slice(i + TAG.length, end > i ? Math.min(end, i + TAG.length + 32) : i + TAG.length + 32).toString('latin1');
    if (VERSION_RE.test(v)) version = v;
  }
  return { ok: true, version, isAhirbot: i >= 0 };
};

const save = (buf, { version, notes, filename, uploadedBy }) => new Promise((resolve, reject) => {
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  const stream = bucket().openUploadStream(filename || `ahirbot-${version}.bin`, {
    contentType: 'application/octet-stream',
    metadata: { version, notes: notes || '', md5, size: buf.length, uploadedBy },
  });
  stream.on('error', reject);
  stream.on('finish', () => resolve(stream.id));
  stream.end(buf);
});

const list = async () => (await files().find().sort({ uploadDate: -1 }).limit(100).toArray()).map(toInfo);

const toInfo = (f) => ({
  id: String(f._id), filename: f.filename, size: f.length, uploadedAt: f.uploadDate,
  version: f.metadata?.version || null, notes: f.metadata?.notes || '', md5: f.metadata?.md5 || null, uploadedBy: f.metadata?.uploadedBy || null,
});

const get = async (id) => {
  const _id = toId(id);
  if (!_id) return null;
  const f = await files().findOne({ _id });
  return f ? toInfo(f) : null;
};

// Tamamı belleğe okunur ve Content-Length ile tek seferde gönderilir (ESP32 boyutu önceden bilmeli)
const read = (id) => new Promise((resolve, reject) => {
  const chunks = [];
  bucket().openDownloadStream(toId(id))
    .on('data', (c) => chunks.push(c))
    .on('error', reject)
    .on('end', () => resolve(Buffer.concat(chunks)));
});

const remove = async (id) => {
  const _id = toId(id);
  if (!_id) return false;
  try { await bucket().delete(_id); return true; } catch { return false; }
};

// Robota giden OTA komutunun içeriği. Robot dosyayı kendi anahtarıyla /device/firmware/<id>'den indirir.
const otaPayload = (fw) => ({ fw: fw.id, version: fw.version, md5: fw.md5, size: fw.size });

module.exports = { MAX_BYTES, VERSION_RE, inspect, save, list, get, read, remove, otaPayload };
