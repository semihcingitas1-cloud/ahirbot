const User = require('../models/User');
const FarmMember = require('../models/FarmMember');

// ─────────────────────────────────────────────────────────────
// Expo Push ile bildirim (ücretsiz). Uygulama Expo push token'ını
// POST /notifications/register-token ile kaydeder; burada çiftlik sahibine
// ve aktif ekip üyelerine gönderilir.
// ─────────────────────────────────────────────────────────────

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CRITICAL = ['blocked', 'error'];

const farmUserIds = async (farmId) => {
  const members = await FarmMember.find({ owner: farmId, status: 'active', user: { $exists: true } }).select('user');
  return [farmId, ...members.map((m) => m.user)];
};

const sendPush = async (farmId, { title, body, type = 'info', data = {} }) => {
  try {
    const users = await User.find({ _id: { $in: await farmUserIds(farmId) } }).select('+pushTokens');
    const tokens = [...new Set(users.flatMap((u) => (u.pushTokens || []).map((t) => t.token)))];
    if (!tokens.length) return { sent: 0 };

    const messages = tokens.map((to) => ({
      to, title, body, sound: 'default', priority: 'high',
      channelId: CRITICAL.includes(type) ? 'critical' : 'default',
      data: { type, ...data },
    }));

    const dead = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(5000),
      });
      const json = await res.json().catch(() => ({}));
      (json.data || []).forEach((r, j) => {
        if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') dead.push(chunk[j].to);
      });
    }

    // Uygulaması silinmiş telefonların token'larını temizle
    if (dead.length) await User.updateMany({}, { $pull: { pushTokens: { token: { $in: dead } } } });
    return { sent: tokens.length - dead.length };
  } catch (e) {
    console.error('Push gönderilemedi:', e.message);
    return { sent: 0, error: e.message };
  }
};

module.exports = { sendPush, farmUserIds };
