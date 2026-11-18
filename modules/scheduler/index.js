const cron = require('node-cron');

const { runDailyBilling } = require('../billing/controller');

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
  console.log('Scheduler aktif: job harian 00:05 WIB (invoice periodik dan kontrak berakhir)');
}

module.exports = { startSchedulers };
