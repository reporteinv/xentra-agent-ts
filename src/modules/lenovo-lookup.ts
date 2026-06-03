import axios from 'axios';
import pool = require('../db');

interface LenovoWarranty {
  brand: string;
  productName: string;
  serialNumber: string;
  warrantyStart: string;
  warrantyEnd: string;
}

function calcularStatus(fechaFin: string): string {
  const hoy = new Date();
  const fin = new Date(fechaFin.split('/').reverse().join('-'));
  const diffDias = Math.floor((fin.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDias < 0) return 'vencida';
  if (diffDias <= 180) return 'por_vencer';
  return 'vigente';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function consultarLenovo(serial: string): Promise<LenovoWarranty | null> {
  const intentos = 3;
  const delays = [2000, 5000, 10000];

  for (let i = 0; i < intentos; i++) {
    try {
      const url = `https://warranty-check.sigatics.com/warranty/${serial}`;
      const resp = await axios.get(url, { timeout: 8000 });
      if (resp.data && resp.data['Product Name']) {
        return {
          brand: resp.data['Brand'],
          productName: resp.data['Product Name'],
          serialNumber: resp.data['Serial Number'],
          warrantyStart: resp.data['Warranty Start'],
          warrantyEnd: resp.data['Warranty End']
        };
      }
    } catch (err) {
      console.warn(`[lenovo-lookup] Intento ${i + 1}/3 fallido para serial ${serial}`);
    }
    if (i < intentos - 1) await sleep(delays[i]);
  }

  console.error(`[lenovo-lookup] Serial ${serial} fallido tras 3 intentos`);
  return null;
}

export async function lookupYActualizar(pcId: number, serial: string, marca: string): Promise<void> {
  // Detectar Lenovo por marca O por serial (seriales Lenovo empiezan con MJ)
  const esLenovo = (marca && marca.toLowerCase().includes('lenovo')) ||
                   (serial && serial.toUpperCase().startsWith('MJ'));
  if (!esLenovo) {
    await pool.query(
      `UPDATE pcs SET lookup_status = 'no_soportado' WHERE id = ?`,
      [pcId]
    );
    return;
  }

  const datos = await consultarLenovo(serial);

  if (!datos) {
    await pool.query(
      `UPDATE pcs SET lookup_status = 'error', lookup_fecha = NOW() WHERE id = ?`,
      [pcId]
    );
    return;
  }

  const toISO = (f: string) => f.split('/').reverse().join('-');
  const status = calcularStatus(datos.warrantyEnd);

  await pool.query(
    `UPDATE pcs SET
      modelo_oficial = ?,
      garantia_inicio = ?,
      garantia_fin = ?,
      garantia_status = ?,
      lookup_fecha = NOW(),
      lookup_status = 'ok'
    WHERE id = ?`,
    [datos.productName, toISO(datos.warrantyStart), toISO(datos.warrantyEnd), status, pcId]
  );
}
