const pool = require('./dist/db');
const { lookupYActualizar } = require('./dist/modules/lenovo-lookup');

async function relookupMasivo() {
  console.log('[cron-lookup] Iniciando relookup masivo...');
  try {
    const [pcs] = await pool.query(`
      SELECT id, serial, modelo FROM pcs
      WHERE activo = 1
      AND (
        lookup_status IS NULL OR
        lookup_status = 'pendiente' OR
        lookup_status = 'error' OR
        (lookup_status = 'ok' AND lookup_fecha < DATE_SUB(NOW(), INTERVAL 30 DAY))
      )
      AND (serial LIKE 'MJ%' OR modelo LIKE '%Lenovo%' OR modelo LIKE '%ThinkCentre%' OR modelo LIKE '%ThinkStation%')
      ORDER BY id ASC
    `);

    console.log('[cron-lookup] PCs a procesar: ' + pcs.length);

    for (let i = 0; i < pcs.length; i++) {
      const pc = pcs[i];
      try {
        await lookupYActualizar(pc.id, pc.serial, pc.modelo || '');
        console.log('[cron-lookup] ' + (i+1) + '/' + pcs.length + ' OK: ' + pc.serial);
      } catch(e) {
        console.error('[cron-lookup] Error en ' + pc.serial + ': ' + e.message);
      }
      // Delay 3 segundos entre cada consulta para no saturar la API
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log('[cron-lookup] Relookup masivo completado.');
  } catch(e) {
    console.error('[cron-lookup] Error general: ' + e.message);
  }
  process.exit(0);
}

relookupMasivo();
