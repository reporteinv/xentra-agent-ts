import axios from 'axios';
import pool = require('../db');

interface IpGuideResult {
  ip: string;
  organization: string | null;
  country: string | null;
  city: string | null;
  timezone: string | null;
  lat: number | null;
  lng: number | null;
}

function esIpPrivada(ip: string): boolean {
  if (!ip) return true;
  return (
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.2') ||
    ip.startsWith('172.30.') ||
    ip.startsWith('172.31.') ||
    ip.startsWith('127.') ||
    ip.startsWith('169.254.')
  );
}

async function consultarIpGuide(ip: string): Promise<IpGuideResult | null> {
  try {
    const resp = await axios.get(`https://ip.guide/${ip}`, { timeout: 5000 });
    const d = resp.data;
    return {
      ip,
      organization: d.network?.autonomous_system?.organization || null,
      country: d.location?.country || null,
      city: d.location?.city || null,
      timezone: d.location?.timezone || null,
      lat: d.location?.latitude || null,
      lng: d.location?.longitude || null,
    };
  } catch (e) {
    return null;
  }
}

export async function ipLookupYActualizar(pcId: number, ip: string): Promise<void> {
  if (!ip || esIpPrivada(ip)) {
    await pool.query(
      'UPDATE pcs SET ip_publica = 0, ip_lookup_fecha = NOW() WHERE id = ?',
      [pcId]
    );
    return;
  }

  const datos = await consultarIpGuide(ip);
  if (!datos) return;

  await pool.query(
    `UPDATE pcs SET
      ip_publica = 1,
      ip_org = ?,
      ip_pais = ?,
      ip_ciudad = ?,
      ip_timezone = ?,
      ip_lat = ?,
      ip_lng = ?,
      ip_lookup_fecha = NOW()
    WHERE id = ?`,
    [datos.organization, datos.country, datos.city, datos.timezone, datos.lat, datos.lng, pcId]
  );
}
