// Kamar diisi penyewa: dipanggil saat kontrak berubah dari pending ke active (invoice pertama lunas)
async function occupyRoom(client, roomId) {
  const row = (await client.query(
    `UPDATE rooms SET status = 'occupied', updated_at = now()
     WHERE id = $1 AND status <> 'maintenance'
     RETURNING id`,
    [roomId]
  )).rows[0];
  if (!row) {
    throw new Error(`Gagal mengisi kamar #${roomId}: kamar tidak ditemukan atau sedang maintenance.`);
  }
  return row;
}

// Kamar dibebaskan: dipanggil saat kontrak terminate/cancel (dan completed oleh scheduler)
async function releaseRoom(client, roomId) {
  const row = (await client.query(
    `UPDATE rooms SET status = 'available', updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [roomId]
  )).rows[0];
  if (!row) {
    throw new Error(`Gagal membebaskan kamar #${roomId}: kamar tidak ditemukan.`);
  }
  return row;
}

module.exports = { occupyRoom, releaseRoom };
