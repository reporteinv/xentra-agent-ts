import * as nodemailer from 'nodemailer';
import * as https from 'https';
import pool = require('../db');
import { RowDataPacket } from 'mysql2/promise';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});

async function enviarWhatsApp(mensaje: string): Promise<void> {
  const phone   = process.env.CALLMEBOT_PHONE;
  const apikey  = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) return;
  const texto   = encodeURIComponent(mensaje);
  const url     = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${texto}&apikey=${apikey}`;
  await new Promise<void>((resolve) => {
    https.get(url, () => resolve()).on('error', () => resolve());
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

    console.log(`[Alertas] ${(pcs as any[]).length} PCs sin reporte — alerta enviada`);
  } catch (e: any) {
    console.error('[Alertas] Error:', e.message);
  }
}

export { verificarPcsSinReporte };
