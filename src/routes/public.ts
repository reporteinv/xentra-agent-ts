import { Router, Request, Response } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2/promise';
import { apiAuth } from '../middleware/apiAuth';

const router = Router();

router.get('/api/public/pcs', apiAuth, async (req: Request, res: Response) => {
  try {
    const empresaId = (req as any).apiEmpresaId;
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT serial, nombre_equipo, modelo, usuario, ip_local,
        disco_libre_gb, disco_total_gb, ram_gb, procesador,
        version_windows, antivirus, garantia_status, garantia_fin,
        ultimo_reporte, version_agente,
        CASE
          WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 'inactivo'
          WHEN (disco_libre_gb / disco_total_gb) < 0.20 THEN 'alerta'
          ELSE 'activo'
        END AS estado
      FROM pcs
      WHERE empresa_id=? AND activo=1 AND deleted_at IS NULL
      ORDER BY nombre_equipo ASC
    `, [empresaId]);
    res.json({ total: (rows as any[]).length, pcs: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/public/stats', apiAuth, async (req: Request, res: Response) => {
  try {
    const empresaId = (req as any).apiEmpresaId;
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) as activos,
        SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) as inactivos,
        SUM(CASE WHEN (disco_libre_gb / disco_total_gb) < 0.20 THEN 1 ELSE 0 END) as alertas_disco,
        SUM(CASE WHEN garantia_status='vencida' THEN 1 ELSE 0 END) as garantias_vencidas
      FROM pcs WHERE empresa_id=? AND activo=1 AND deleted_at IS NULL
    `, [empresaId]);
    res.json((rows as any[])[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
