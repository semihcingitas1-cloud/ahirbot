const express = require('express');

const User = require('../models/User');
const FarmMember = require('../models/FarmMember');
const sendEmail = require('../utils/sendEmail');
const { esc } = require('../utils/page');
const { requireUser, requireRole } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────
// Çiftlik ekibi (smartHome/familyApi'deki aile yapısının sade hali)
//   GET    /team                  → { me: {role, farmName, ownerName}, members: [...] }
//   POST   /team/invites          → { email, role }   (sahip)
//   PATCH  /team/members/:id      → { role }          (sahip)
//   DELETE /team/members/:id                          (sahip; davet de iptal olur)
//   GET    /team/invites/mine     → bana gelen davetler
//   POST   /team/invites/:id/respond → { accept }
//   POST   /team/leave            → üyelikten çık (kendi çiftliğine döner)
// ─────────────────────────────────────────────────────────────

const router = express.Router();
const ownerOnly = requireRole('owner');

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
const ROLE_TR = { owner: 'Sahip', manager: 'Yönetici', worker: 'Çalışan' };

const memberToApp = (m) => ({
  id: String(m._id),
  email: m.email,
  name: m.user?.name || '',
  role: m.role,
  roleLabel: ROLE_TR[m.role],
  status: m.status,
});

router.get('/team', requireUser, async (req, res) => {
  const owner = req.farmOwner;
  const members = await FarmMember.find({ owner: req.farmId }).populate('user', 'name email').sort('createdAt');
  res.json({
    me: { role: req.farmRole, roleLabel: ROLE_TR[req.farmRole], ownerName: owner.name, isOwner: req.farmRole === 'owner' },
    owner: { name: owner.name, email: req.farmRole === 'owner' ? owner.email : undefined },
    members: members.filter((m) => req.farmRole === 'owner' || m.status === 'active').map(memberToApp),
  });
});

router.post('/team/invites', requireUser, ownerOnly, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = FarmMember.ROLES.includes(req.body?.role) ? req.body.role : 'worker';
  if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Geçerli bir e-posta girin.' });
  if (email === req.user.email) return res.status(400).json({ message: 'Kendinizi davet edemezsiniz.' });

  const invitee = await User.findOne({ email });
  if (invitee && await FarmMember.exists({ user: invitee._id, status: 'active' })) {
    return res.status(400).json({ message: 'Bu kişi zaten bir çiftlik ekibinde.' });
  }

  let member;
  try {
    member = await FarmMember.create({ owner: req.farmId, email, role });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Bu e-posta zaten davet edilmiş.' });
    throw error;
  }

  // E-posta gönderilemese de davet geçerli: kişi uygulamaya bu e-postayla girince görür
  let emailed = true;
  try {
    await sendEmail({
      to: email,
      subject: `${req.user.name} sizi AhırBot çiftliğine davet etti`,
      html: `<p>Merhaba,</p>
        <p><b>${esc(req.user.name)}</b> sizi AhırBot'ta çiftlik ekibine <b>${ROLE_TR[role]}</b> olarak davet etti.</p>
        <p>AhırBot uygulamasına bu e-posta adresiyle ${invitee ? 'giriş yapın' : 'kaydolun'}; davet Ayarlar &gt; Çiftlik ekibi bölümünde görünecek.</p>`,
    });
  } catch (e) {
    emailed = false;
    console.error('Davet e-postası gönderilemedi:', e.message);
  }

  res.status(201).json({ member: memberToApp(member), emailed });
});

router.patch('/team/members/:id', requireUser, ownerOnly, async (req, res) => {
  const role = req.body?.role;
  if (!FarmMember.ROLES.includes(role)) return res.status(400).json({ message: 'Geçersiz rol.' });
  const m = await FarmMember.findOneAndUpdate({ _id: req.params.id, owner: req.farmId }, { role }, { new: true }).populate('user', 'name email');
  if (!m) return res.status(404).json({ message: 'Üye bulunamadı.' });
  res.json(memberToApp(m));
});

router.delete('/team/members/:id', requireUser, ownerOnly, async (req, res) => {
  await FarmMember.deleteOne({ _id: req.params.id, owner: req.farmId });
  res.json({ success: true });
});

router.get('/team/invites/mine', requireUser, async (req, res) => {
  const invites = await FarmMember.find({ email: req.user.email, status: 'pending' }).populate('owner', 'name');
  res.json(invites.map((i) => ({ id: String(i._id), ownerName: i.owner?.name || '', role: i.role, roleLabel: ROLE_TR[i.role] })));
});

router.post('/team/invites/:id/respond', requireUser, async (req, res) => {
  const invite = await FarmMember.findOne({ _id: req.params.id, email: req.user.email, status: 'pending' });
  if (!invite) return res.status(404).json({ message: 'Davet bulunamadı.' });

  if (!req.body?.accept) {
    await invite.deleteOne();
    return res.json({ success: true, accepted: false });
  }
  if (await FarmMember.exists({ user: req.user._id, status: 'active' })) {
    return res.status(400).json({ message: 'Önce mevcut çiftlik ekibinden ayrılın.' });
  }
  invite.user = req.user._id;
  invite.status = 'active';
  await invite.save();
  res.json({ success: true, accepted: true });
});

router.post('/team/leave', requireUser, async (req, res) => {
  await FarmMember.deleteMany({ user: req.user._id, status: 'active' });
  res.json({ success: true });
});

module.exports = router;
