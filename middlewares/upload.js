const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('../config');
const ApiError = require('../utils/ApiError');

// Pastikan folder uploads ada (di luar folder publik)
fs.mkdirSync(config.upload.dir, { recursive: true });

// Nama file acak uuid tanpa ekstensi; ekstensi ditambah setelah magic bytes tervalidasi
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.upload.dir),
  filename: (req, file, cb) => cb(null, crypto.randomUUID()),
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxFileSize, files: 1 },
  // Filter awal berdasar mimetype pendaftar; isi file tetap diverifikasi magic bytes
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png'].includes(file.mimetype)) return cb(null, true);
    return cb(new ApiError(400, 'Tipe file harus JPEG atau PNG.'));
  },
});

// Terima SATU foto tiket dari field 'photo'
function uploadTicketPhoto(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (!err) {
      res.on('finish', () => {
        if (res.statusCode >= 400 && req.file) {
          fs.promises.unlink(req.file.path).catch(() => { });
        }
      });
      return next();
    }

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(400, 'Ukuran foto maksimal 2 MB.'));
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new ApiError(400, "Field foto harus tepat satu file bernama 'photo'."));
    }
    return next(err);
  });
}

module.exports = { uploadTicketPhoto };
