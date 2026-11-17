const fs = require('fs/promises');
const path = require('path');

const ApiError = require('./ApiError');

// Validasi isi file berdasarkan MAGIC BYTES, bukan ekstensi/nama
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]; // FF D8 FF
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]; // \x89PNG\r\n\x1a\n

// Deteksi jenis gambar 'jpeg' | 'png' | null
function detectImageType(buffer) {
  if (
    buffer.length >= JPEG_SIGNATURE.length &&
    JPEG_SIGNATURE.every((byte, i) => buffer[i] === byte)
  ) {
    return 'jpeg';
  }
  if (
    buffer.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)
  ) {
    return 'png';
  }
  return null;
}

// Deteksi jenis gambar dari 8 byte pertama file di disk
async function detectImageTypeFromFile(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const { buffer } = await handle.read(Buffer.alloc(8), 0, 8, 0);
    return detectImageType(buffer);
  } finally {
    await handle.close();
  }
}

// Finalisasi foto upload multer:
// Kembalikan nama file final untuk disimpan ke kolom issue_tickets.photo_path
async function finalizePhotoUpload(file) {
  if (!file) return null; // foto opsional

  try {
    const type = await detectImageTypeFromFile(file.path);
    if (!type) {
      await fs.unlink(file.path).catch(() => { });
      throw new ApiError(400, 'Isi file bukan foto JPEG/PNG yang valid.');
    }

    const finalName = `${file.filename}.${type === 'jpeg' ? 'jpg' : 'png'}`;
    const finalPath = path.join(path.dirname(file.path), finalName);
    await fs.rename(file.path, finalPath);

    // Perbarui info file di request agar pembersih middleware memakai path final
    file.filename = finalName;
    file.path = finalPath;
    file.mimetype = type === 'jpeg' ? 'image/jpeg' : 'image/png';

    return finalName;
  } catch (err) {
    // Gagal di luar validasi, buang file sementara lalu teruskan error
    if (!(err instanceof ApiError)) {
      await fs.unlink(file.path).catch(() => { });
    }
    throw err;
  }
}

module.exports = { detectImageType, detectImageTypeFromFile, finalizePhotoUpload };
