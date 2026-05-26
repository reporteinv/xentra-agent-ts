const pool = require('./dist/db');
const { ipLookupYActualizar } = require('./dist/modules/ip-lookup');

async function ipLookupMasivo() {
  console.log('[cron-ip] Iniciando ip lookup masivo...');
  try {
    const [pcs] = await pool.query(`
      SELECT id, ip_local FROM pcs
      WHERE activo = 1
      AND ip_local IS NOT NULL
      AND (ip_lookup_fecha IS NULL OR ip_lookup_fecha < DATE_SUB(NOW(), INTERVAL 7 DAY))
    `);

    console.log('[cron-ip] PCs a procesar: ' + pcs.length);

    for (let i = 0; i < pcs.length; i++) {
      const pc = pcs[i];
      try {
        await ipLookupYActualizar(pc.id, pc.ip_local);
        console.log('[cron-ip] ' + (i+1) + '/' + pcs.length + ' OK: ' + pc.ip_local);
      } catch(e) {
        console.error('[cron-ip] Error en ' + pc.ip_local + ': ' + e.message);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    console.log('[cron-ip] Completado.');
  } catch(e) {
    console.error('[cron-ip] Error general: ' + e.message);
  }
  process.exit(0);
}

ipLookupMasivo();
