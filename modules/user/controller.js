const service = require('./service');

// Lihat profil sendiri
async function getMe(req, res, next) {
  try {
    const profile = await service.getProfile(req.user.id);
    res.status(200).json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
}

// Ubah profil sendiri
async function updateMe(req, res, next) {
  try {
    const profile = await service.updateProfile(req.user.id, req.body || {});
    res.status(200).json({ success: true, message: 'Profil berhasil diperbarui.', data: profile });
  } catch (err) {
    next(err);
  }
}

// Ganti password sendiri
async function changeMyPassword(req, res, next) {
  try {
    const result = await service.changePassword(req.user.id, req.body || {});
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe, updateMe, changeMyPassword };
