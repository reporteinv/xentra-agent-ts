import { Router, Request, Response } from 'express';
import pool from '../db';
import { logInfo, logError } from '../modules/logger';

const router = Router();

// GET /api/licencias — listar licencias de la empresa
router.get('/api/licencias', async (req: Request, res: Response) => {
  try {
    if (!(req.session as any)?.autenticado) return res.status(401).json({ error: 'No autenticado' });
    const empresaId = (req.session as any)?.empresa_id || 26;

    const [rows] = await pool.query(`
      SELECT l.*,
        COUNT(DISTINCT p.pc_id) AS instalaciones
      FROM xentra_licencias l
      LEFT JOIN pcs_programas p ON p.nombre LIKE CONCAT('%', l.nombre, '%')
        AND p.pc_id IN (SELECT id FROM pcs WHERE empresa_id = ? AND activo = 1)
      WHERE l.empresa_id = ? AND l.activo = 1
      GROUP BY l.id
      ORDER BY l.nombre ASC
    `, [empresaId, empresaId]);

    res.json(rows);
  } catch (err: any) {
    logError('GET_LICENCIAS', err.message);
    res.status(500).json({ error: 'Error consultando licencias' });
  }
});

// POST /api/licencias — crear licencia
router.post('/api/licencias', async (req: Request, res: Response) => {
  try {
    if (!(req.session as any)?.autenticado) return res.status(401).json({ error: 'No autenticado' });
    const empresaId = (req.session as any)?.empresa_id || 26;

    const { nombre, fabricante, total, vencimiento, proveedor, notas } = req.body;
    if (!nombre || !total) return res.status(400).json({ error: 'nombre y total requeridos' });

    const [result]: any = await pool.query(`
      INSERT INTO xentra_licencias (empresa_id, nombre, fabricante, total, vencimiento, proveedor, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [empresaId, nombre, fabricante || null, total, vencimiento || null, proveedor || null, notas || null]);

    logInfo('LICENCIA_CREADA');
    res.json({ ok: true, id: result.insertId });
  } catch (err: any) {
    logError('POST_LICENCIAS', err.message);
    res.status(500).json({ error: 'Error creando licencia' });
  }
});

// PUT /api/licencias/:id — editar licencia
router.put('/api/licencias/:id', async (req: Request, res: Response) => {
  try {
    if (!(req.session as any)?.autenticado) return res.status(401).json({ error: 'No autenticado' });
    const empresaId = (req.session as any)?.empresa_id || 26;

    const { nombre, fabricante, total, vencimiento, proveedor, notas } = req.body;
    await pool.query(`
      UPDATE xentra_licencias SET nombre=?, fabricante=?, total=?, vencimiento=?, proveedor=?, notas=?
      WHERE id=? AND empresa_id=?
    `, [nombre, fabricante || null, total, vencimiento || null, proveedor || null, notas || null, req.params.id, empresaId]);

    logInfo('LICENCIA_EDITADA');
    res.json({ ok: true });
  } catch (err: any) {
    logError('PUT_LICENCIAS', err.message);
    res.status(500).json({ error: 'Error editando licencia' });
  }
});

// DELETE /api/licencias/:id — soft delete
router.delete('/api/licencias/:id', async (req: Request, res: Response) => {
  try {
    if (!(req.session as any)?.autenticado) return res.status(401).json({ error: 'No autenticado' });
    const empresaId = (req.session as any)?.empresa_id || 26;

    await pool.query(`
      UPDATE xentra_licencias SET activo=0 WHERE id=? AND empresa_id=?
    `, [req.params.id, empresaId]);

    logInfo('LICENCIA_ELIMINADA');
    res.json({ ok: true });
  } catch (err: any) {
    logError('DELETE_LICENCIAS', err.message);
    res.status(500).json({ error: 'Error eliminando licencia' });
  }
});

// GET /api/licencias/alertas — vencidas o por vencer en 30 días
router.get('/api/licencias/alertas', async (req: Request, res: Response) => {
  try {
    if (!(req.session as any)?.autenticado) return res.status(401).json({ error: 'No autenticado' });
    const empresaId = (req.session as any)?.empresa_id || 26;

    const [rows] = await pool.query(`
      SELECT *, DATEDIFF(vencimiento, NOW()) AS dias_restantes
      FROM xentra_licencias
      WHERE empresa_id = ? AND activo = 1
        AND vencimiento IS NOT NULL
        AND vencimiento <= DATE_ADD(NOW(), INTERVAL 30 DAY)
      ORDER BY vencimiento ASC
    `, [empresaId]);

    res.json(rows);
  } catch (err: any) {
    logError('GET_LICENCIAS_ALERTAS', err.message);
    res.status(500).json({ error: 'Error consultando alertas' });
  }
});


// GET /api/licencias/programas-disponibles — lista programas únicos para el dropdown
router.get('/api/licencias/programas-disponibles', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT nombre, fabricante, COUNT(DISTINCT pc_id) AS total_pcs
      FROM pcs_programas
      GROUP BY nombre, fabricante
      ORDER BY nombre ASC
    `);
    res.json(rows);
  } catch (err: any) {
    logError('GET_PROGRAMAS_DISPONIBLES', err.message);
    res.status(500).json({ error: 'Error consultando programas' });
  }
});

export default router;
