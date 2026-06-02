import { Request, Response, NextFunction } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2/promise';

export async function apiAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, empresa_id, expira_en FROM api_tokens
       WHERE token=? AND activo=1
       AND (expira_en IS NULL OR expira_en >= CURDATE())`,
      [token]
    );
    const row = (rows as any[])[0];
    if (!row) return res.status(401).json({ error: 'Token invalido o expirado' });

    await pool.query('UPDATE api_tokens SET ultimo_uso=NOW() WHERE id=?', [row.id]);
    (req as any).apiEmpresaId = row.empresa_id;
    next();
  } catch (err: any) {
    res.status(500).json({ error: 'Error de autenticacion' });
  }
}
