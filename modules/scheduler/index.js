const cron = require('node-cron');

const { runDailyBilling, expirePayments } = require('../billing/controller');

// Mulai semua job berkala
function startSchedulers() {
  // Job harian 00:05 WIB: terbitkan invoice periodik dan tutup kontrak berakhir
  cron.schedule('5 17 * * *', async () => {
    try {
      const hasil = await runDailyBilling();
      console.log(`[job-harian] invoice terbit: ${hasil.issued}, kontrak selesai: ${hasil.completed}`);
    } catch (err) {
      console.error('[job-harian] gagal:', err.message);
    }
  });
  // Job 15 menit: payment kedaluwarsa jadi expire dan invoice kembali unpaid
  cron.schedule('*/15 * * * *', async () => {
    try {
      const hasil = await expirePayments();
      if (hasil.expired > 0) {
        console.log(`[job-kedaluwarsa] payment expire: ${hasil.expired}`);
      }
    } catch (err) {
      console.error('[job-kedaluwarsa] gagal:', err.message);
    }
  });
  console.log('Scheduler aktif: job harian 00:05 WIB (invoice periodik dan kontrak berakhir), job 15 menit (payment kedaluwarsa)');
}

module.exports = { startSchedulers };
