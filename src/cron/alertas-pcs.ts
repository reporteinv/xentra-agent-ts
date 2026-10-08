import * as nodemailer from 'nodemailer';
import { logInfo, logError } from '../modules/logger';
import * as https from 'https';
import pool = require('../db');
import { RowDataPacket } from 'mysql2/promise';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});

// Antes CallMeBot (WhatsApp); desde 8 oct 2026 Telegram (CallMeBot sin mensajes gratis).
// Se mantiene el nombre para no cambiar a quien la llama. Devuelve true solo si Telegram confirma.
async function enviarWhatsApp(mensaje: string): Promise<boolean> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const fallo = (motivo: string) =>
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), nivel: 'error', evento: 'ALERTA_TELEGRAM_ERROR', error: motivo }));
  if (!token || !chatId) { fallo('Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en .env'); return false; }
  const body = JSON.stringify({ chat_id: chatId, text: mensaje });
  return await new Promise<boolean>((resolve) => {
    const req = https.request(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let ok = false;
        try { ok = JSON.parse(d).ok === true; } catch {}
        if (!ok) fallo(`HTTP ${res.statusCode}: ${d.slice(0, 200)}`);
        resolve(ok);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => { fallo(e.message); resolve(false); });
    req.write(body);
    req.end();
  });
}

async function verificarPcsSinReporte(): Promise<void> {
  try {
    const [pcs] = await pool.query<RowDataPacket[]>(`
      SELECT nombre_equipo, usuario, ultimo_reporte,
        TIMESTAMPDIFF(MINUTE, ultimo_reporte, NOW()) AS minutos_sin_reporte
      FROM pcs
      WHERE activo = 1
        AND ultimo_reporte < DATE_SUB(NOW(), INTERVAL 1 HOUR)
        AND ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
      ORDER BY minutos_sin_reporte DESC
    `);

    if ((pcs as any[]).length === 0) return;

    const lista = (pcs as any[]).map(pc =>
      `- ${pc.nombre_equipo} (${pc.usuario}) sin reporte hace ${pc.minutos_sin_reporte} min`
    ).join('\n');

    const asunto = `Xentrasoft: ${(pcs as any[]).length} PC(s) sin reporte`;
    const texto  = `PCs sin reporte en la ultima hora:\n\n${lista}\n\nVerifica conectividad o estado del agente.`;

    await transporter.sendMail({
      from: 'Xentrasoft <reporte@xentrasoft.com>',
      to: process.env.ALERT_EMAIL,
      subject: asunto,
      text: texto
    });

    await enviarWhatsApp(`Xentrasoft: ${(pcs as any[]).length} PC(s) sin reporte hace >1h. Revisa el dashboard.`);

    logInfo('ALERTA_PCS', { mensaje: `${(pcs as any[]).length} PCs sin reporte — alerta enviada` });
  } catch (e: any) {
    logError('ALERTA_PCS_ERROR', e.message);
  }
}

export { verificarPcsSinReporte };
