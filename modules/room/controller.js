const ApiError = require('../../utils/ApiError');
const service = require('./service');
const { paginated } = require('../../utils/pagination');

const VALID_STATUS = ['available', 'occupied', 'maintenance'];

// Daftar kamar
async function list(req, res, next) {
  try {
    // Validasi Filter Status
    const status = req.query.status;
    if (status && !VALID_STATUS.includes(status)) {
      throw new ApiError(400, `Filter status harus salah satu dari: ${VALID_STATUS.join(', ')}.`);
    }

    const { rows, total } = await service.list({ status, pagination: req.pagination });
    res.status(200).json({ success: true, ...paginated(rows, total, req.pagination) });
  } catch (err) {
    next(err);
  }
}

// Tambah kamar
async function create(req, res, next) {
  try {
    const { room_number, room_type, facilities, price, status } = req.body || {};

    // Validasi Wajib Isi
    if (!room_number || !room_type) {
      throw new ApiError(400, 'Nomor kamar dan tipe kamar wajib diisi.');
    }
    // Validasi Harga Harus Angka Positif
    if (price !== undefined && price !== null && (!(Number(price) > 0) || !Number.isFinite(Number(price)))) {
      throw new ApiError(400, 'Harga sewa harus berupa angka lebih besar dari 0.');
    }
    // Validasi Status Tidak Boleh Diinput Manual (diatur otomatis oleh kontrak)
    if (status !== undefined) {
      throw new ApiError(400, 'Status kamar tidak dapat diinput manual. Kamar baru otomatis tersedia; status diatur sistem.');
    }

    const room = await service.create({
      room_number: String(room_number).trim(),
      room_type: String(room_type).trim(),
      facilities: facilities ?? null,
      price: price === '' ? null : price,
    });
    res.status(201).json({ success: true, message: 'Kamar berhasil ditambahkan.', data: room });
  } catch (err) {
    next(err);
  }
}

// Ubah kamar
async function update(req, res, next) {
  try {
    const { room_number, room_type, facilities, price, status } = req.body || {};
    const isOwner = req.user.role === 'owner';

    // Validasi Minimal Satu Field
    const allUndefined =
      room_number === undefined &&
      room_type === undefined &&
      facilities === undefined &&
      price === undefined &&
      status === undefined;
    if (allUndefined) {
      throw new ApiError(400, 'Isi minimal satu field yang ingin diubah.');
    }

    // Cari kamar
    const room = await service.findById(req.params.id);
    // Validasi Kamar Ditemukan
    if (!room) throw new ApiError(404, 'Kamar tidak ditemukan.');

    // Validasi Hak Caretaker (caretaker tidak boleh ubah harga & status)
    if (!isOwner && (price !== undefined || status !== undefined)) {
      throw new ApiError(403, 'Perubahan harga sewa dan status kamar hanya dapat dilakukan oleh owner.');
    }

    // Validasi Harga Harus Angka Positif
    if (price !== undefined && (!(Number(price) > 0) || !Number.isFinite(Number(price)))) {
      throw new ApiError(400, 'Harga sewa harus berupa angka lebih besar dari 0.');
    }

    // Validasi Aturan Status (available/occupied diatur otomatis oleh kontrak)
    if (status !== undefined) {
      if (status === 'occupied') {
        throw new ApiError(400, 'Status occupied diatur otomatis oleh sistem saat kamar terkontrak.');
      }
      if (status === 'available' && room.status !== 'maintenance') {
        throw new ApiError(400, 'Status available diatur otomatis oleh sistem. Kamar hanya dapat dikembalikan ke available dari kondisi maintenance.');
      }
    }

    // Susun field yang boleh diubah
    const fields = {};
    if (room_number !== undefined) fields.room_number = String(room_number).trim();
    if (room_type !== undefined) fields.room_type = String(room_type).trim();
    if (facilities !== undefined) fields.facilities = facilities;
    if (price !== undefined) fields.price = price;
    if (status !== undefined) fields.status = status;

    // Validasi Nomor Kamar Sudah Dipakai kamar lain
    if (fields.room_number && fields.room_number !== room.room_number) {
      const dup = await service.findByNumber(fields.room_number);
      if (dup && dup.id !== room.id) {
        throw new ApiError(409, `Nomor kamar ${fields.room_number} sudah dipakai.`);
      }
    }

    // Validasi Nomor Kamar Tidak Boleh Diubah Saat Terisi
    if (fields.room_number && room.status === 'occupied') {
      throw new ApiError(409, 'Nomor kamar tidak dapat diubah saat kamar sedang terisi.');
    }

    const updated = await service.update(room.id, fields);
    res.status(200).json({ success: true, message: 'Kamar berhasil diperbarui.', data: updated });
  } catch (err) {
    next(err);
  }
}

// Hapus kamar
async function remove(req, res, next) {
  try {
    const result = await service.remove(req.params.id);
    res.status(200).json({ success: true, message: `Kamar ${result.room_number} berhasil dihapus.` });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
