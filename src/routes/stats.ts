import express = require('express');
import { Request, Response } from 'express';
import pool = require('../db');
import { RowDataPacket } from 'mysql2/promise';

const router = express.Router();

router.get('/api/pcs/:id/historial', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT fecha, mb_liberados, espacio_libre_gb
      FROM historial_limpiezas WHERE pc_id=? ORDER BY fecha DESC LIMIT 50
    `, [req.params.id]);
    res.json(rows);
  } catch(e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const [kpis] = await pool.query<RowDataPacket[]>(`
      SELECT COUNT(*) AS total_pcs,
        SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 0
          WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 0
          WHEN (espacio_libre_gb / espacio_total_gb) < 0.20 THEN 0 ELSE 1 END) AS activos,
        SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 0
          WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1
          WHEN (espacio_libre_gb / espacio_total_gb) < 0.20 THEN 1 ELSE 0 END) AS alerta,
        SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS inactivos,
        COALESCE(SUM(espacio_libre_gb), 0) AS espacio_libre_total_gb,
        COALESCE(SUM(espacio_total_gb), 0) AS espacio_total_gb
      FROM pcs WHERE activo=1
    `);
    const [totalLiberado] = await pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(mb_liberados), 0) AS mb_total FROM historial_limpiezas');
    const [topPcs] = await pool.query<RowDataPacket[]>(`
      SELECT p.nombre_equipo, p.usuario, COALESCE(SUM(h.mb_liberados), 0) AS total_liberado
      FROM pcs p LEFT JOIN historial_limpiezas h ON h.pc_id = p.id
      WHERE p.activo=1 GROUP BY p.id, p.nombre_equipo ORDER BY total_liberado DESC LIMIT 10
    `);
    const [porDia] = await pool.query<RowDataPacket[]>(`
      SELECT DATE(fecha) AS dia, COUNT(*) AS cantidad, COALESCE(SUM(mb_liberados), 0) AS mb_dia
      FROM historial_limpiezas WHERE fecha >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(fecha) ORDER BY dia ASC
    `);
    res.json({ kpis: (kpis as any[])[0], mb_total_liberado: (totalLiberado as any[])[0].mb_total, top_pcs: topPcs, por_dia: porDia });
  } catch(e: any) { console.error('[Stats]', e); res.status(500).json({ error: e.message }); }
});

router.get('/api/stats/modelos', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT COALESCE(modelo, 'Desconocido') AS modelo, COUNT(*) AS total,
        SUM(CASE WHEN ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1 ELSE 0 END) AS activos,
        SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1 ELSE 0 END) AS inactivos,
        ROUND(AVG(espacio_libre_gb), 1) AS avg_espacio_libre, ROUND(AVG(ram_gb), 1) AS avg_ram
      FROM pcs WHERE activo=1 GROUP BY modelo ORDER BY total DESC
    `);
    res.json(rows);
  } catch(e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/api/stats/programas', async (req: Request, res: Response) => {
  if (!(req.session as any).autenticado) return res.status(401).json({ error: 'No autenticado' });
  try {
    const [[totales]] = await pool.query<RowDataPacket[]>(`
      SELECT COUNT(*) AS total_registros, COUNT(DISTINCT nombre) AS total_unicos, COUNT(DISTINCT pc_id) AS total_pcs FROM programas
    `) as any;
    const [top10] = await pool.query<RowDataPacket[]>(`
      SELECT nombre, COUNT(DISTINCT pc_id) AS total_pcs FROM programas GROUP BY nombre ORDER BY total_pcs DESC LIMIT 10
    `);
    res.json({ totales, top10 });
  } catch(e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/api/stats/areas', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT CASE
        WHEN usuario LIKE '%Recepcion%' OR usuario LIKE '%alas' THEN 'Admin'
        WHEN usuario LIKE '%Asesor%' THEN 'SecGeneral'
        WHEN usuario LIKE '%Infopu%' THEN 'Comunicaciones'
        WHEN usuario LIKE '%ProyectosE%' THEN 'Reduccion'
        WHEN usuario REGEXP '_[A-Za-z]+$' THEN SUBSTRING_INDEX(usuario, '_', -1)
        ELSE 'Otros' END as area, COUNT(*) as total
      FROM pcs WHERE activo=1 GROUP BY area ORDER BY total DESC
    `);
    res.json(rows);
  } catch(e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/api/programas/:serial', async (req: Request, res: Response) => {
  if (!(req.session as any).autenticado) return res.status(401).json({ error: 'No autenticado' });
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT p.nombre, p.version, p.fabricante FROM programas p
      JOIN pcs ON pcs.id = p.pc_id WHERE pcs.serial=? ORDER BY p.nombre ASC
    `, [req.params.serial]);
    res.json(rows);
  } catch(e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/api/programas', async (req: Request, res: Response) => {
  try {
    const token = req.headers['x-agent-token'];
    if (token !== process.env.AGENT_TOKEN) return res.status(401).json({ error: 'Token invalido' });
    const { serial, programas } = req.body;
    if (!serial || !programas) return res.status(400).json({ error: 'Datos requeridos' });
    const [pc] = await pool.query<RowDataPacket[]>('SELECT id FROM pcs WHERE serial=?', [serial]);
    if (!(pc as any[]).length) return res.status(404).json({ error: 'PC no encontrado' });
    const pc_id = (pc as any[])[0].id;
    await pool.query('DELETE FROM programas WHERE pc_id=?', [pc_id]);
    if (programas.length > 0) {
      const values = programas.map((p: any) => [pc_id, p.nombre, p.version||null, p.fabricante||null]);
      await pool.query('INSERT INTO programas (pc_id, nombre, version, fabricante) VALUES ?', [values]);
    }
    res.json({ ok: true, total: programas.length });
  } catch(e: any) { console.error('[Programas]', e); res.status(500).json({ error: e.message }); }
});

export = router;
