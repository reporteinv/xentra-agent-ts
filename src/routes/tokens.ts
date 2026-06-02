import express, { Request, Response } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2/promise';
import crypto from 'crypto';

const router = express.Router();

function authCheck(req: Request, res: Response, next: any) {
  if (!(req.session as any)?.autenticado) return res.status(401).json({ error: 'No autenticado' });
  next();
}

// GET — listar tokens de la empresa
router.get('/api/tokens', authCheck, async (req: Request, res: Response) => {
  try {
    const empresaId = (req.session as any).empresa_id || 26;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, token, descripcion, ultimo_uso, expira_en, activo, created_at
       FROM api_tokens WHERE empresa_id=? ORDER BY created_at DESC`,
      [empresaId]
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST — generar nuevo token
router.post('/api/tokens', authCheck, async (req: Request, res: Response) => {
  try {
    const empresaId = (req.session as any).empresa_id || 26;
    const { descripcion, expira_en } = req.body;
    const token = 'xnt_' + crypto.randomBytes(24).toString('hex');
    await pool.query(
      `INSERT INTO api_tokens (empresa_id, token, descripcion, expira_en) VALUES (?,?,?,?)`,
      [empresaId, token, descripcion || 'Token API', expira_en || null]
    );
    res.json({ ok: true, token });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — revocar token
router.delete('/api/tokens/:id', authCheck, async (req: Request, res: Response) => {
  try {
    const empresaId = (req.session as any).empresa_id || 26;
    await pool.query(
      `UPDATE api_tokens SET activo=0 WHERE id=? AND empresa_id=?`,
      [req.params.id, empresaId]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE permanente
router.delete('/api/tokens/:id/eliminar', authCheck, async (req: Request, res: Response) => {
  try {
    const empresaId = (req.session as any).empresa_id || 26;
    await pool.query(
      'DELETE FROM api_tokens WHERE id=? AND empresa_id=?',
      [req.params.id, empresaId]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
