import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pool from '../db';
import { RowDataPacket } from 'mysql2/promise';

const router = express.Router();

const SERVIDOR_DEFAULT = 'https://ts.xentrasoft.com'; // servidor de produccion real del agente Go (ag2 es solo el entorno de prueba)

function authCheck(req: Request, res: Response, next: any) {
  if (!(req.session as any)?.autenticado) return res.status(401).json({ error: 'No autenticado' });
  next();
}

// GET — genera el instalador .bat del agente Go para un cliente especifico
// Reusa un token activo existente si lo hay; si no, genera uno nuevo.
router.get('/api/pc/instalador-go/:empresa_id', authCheck, async (req: Request, res: Response) => {
  try {
    const empresaId = parseInt(req.params.empresa_id as string, 10);
    if (isNaN(empresaId)) return res.status(400).json({ error: 'empresa_id invalido' });

    const servidor = (req.query.servidor as string) || SERVIDOR_DEFAULT;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT token FROM api_tokens WHERE empresa_id=? AND activo=1 ORDER BY created_at DESC LIMIT 1`,
      [empresaId]
    );

    let token: string;
    if (rows.length > 0) {
      token = rows[0].token as string;
    } else {
      token = 'xnt_' + crypto.randomBytes(24).toString('hex');
      await pool.query(
        `INSERT INTO api_tokens (empresa_id, token, descripcion) VALUES (?,?,?)`,
        [empresaId, token, 'Instalador Go - generado automaticamente']
      );
    }

    const plantillaPath = path.join(__dirname, '../agents/setup-go.bat.template');
    let contenido = fs.readFileSync(plantillaPath, 'utf8');
    contenido = contenido
      .replace(/__XENTRA_TOKEN__/g, token)
      .replace(/__XENTRA_SERVER__/g, servidor);

    res.setHeader('Content-Disposition', `attachment; filename="xentra-agent-go-${empresaId}.bat"`);
    res.setHeader('Content-Type', 'application/octet-stream; charset=utf-8');
    res.send(contenido);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
