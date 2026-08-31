import { Request, Response, NextFunction } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2/promise';

// Autenticacion de agentes via header X-Agent-Token, resolviendo
// empresa_id desde la tabla api_tokens (nunca confiar en el que
// declare el agente en el body). Fallback al AGENT_TOKEN legacy
// (una sola llave global, hoy usada solo por UNGRD) mientras se
// termina la migracion completa a tokens por cliente.
export async function agentAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers['x-agent-token'] as string) || '';
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, empresa_id, expira_en FROM api_tokens
       WHERE token=? AND activo=1
       AND (expira_en IS NULL OR expira_en >= CURDATE())`,
      [token]
    );
    const row = (rows as any[])[0];
    if (row) {
      await pool.query('UPDATE api_tokens SET ultimo_uso=NOW() WHERE id=?', [row.id]);
      (req as any).apiEmpresaId = row.empresa_id;
      return next();
    }
    // Fallback legacy — deberia dejar de dispararse una vez todo
    // este migrado a api_tokens (ya insertamos el token de UNGRD ahi)
    if (token === process.env.AGENT_TOKEN) {
      console.warn('[agentAuth] Token legacy AGENT_TOKEN usado — deberia estar en api_tokens ya');
      (req as any).apiEmpresaId = 26;
      return next();
    }
    return res.status(401).json({ error: 'Token invalido o expirado' });
  } catch (err: any) {
    res.status(500).json({ error: 'Error de autenticacion' });
  }
}
