import express = require('express');
import { Request, Response } from 'express';
import pool = require('../db');
import { agentAuth } from '../middleware/agentAuth';
const router = express.Router();

// POST /api/update/inicio — PC notifica que va a actualizar
router.post('/api/update/inicio', agentAuth, async (req: Request, res: Response) => {
  try {
    const { serial, version_anterior, version_nueva, sha256_esperado } = req.body;
    const empresa_id = (req as any).apiEmpresaId;
    if (!serial) return res.status(400).json({ error: 'Faltan campos' });
    await pool.query(
      `INSERT INTO pcs_updates (serial, empresa_id, version_anterior, version_nueva, sha256_esperado, status, fecha_inicio)
       VALUES (?, ?, ?, ?, ?, 'iniciando', NOW())`,
      [serial, empresa_id, version_anterior, version_nueva, sha256_esperado]
    );
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/update/resultado — PC notifica resultado del update
router.post('/api/update/resultado', agentAuth, async (req: Request, res: Response) => {
  try {
    const { serial, version_nueva, status, motivo } = req.body;
    const empresa_id = (req as any).apiEmpresaId;
    if (!serial || !status) return res.status(400).json({ error: 'Faltan campos' });
    await pool.query(
      `UPDATE pcs_updates SET status=?, motivo=?, fecha_fin=NOW()
       WHERE serial=? AND empresa_id=? AND version_nueva=?
       ORDER BY fecha_inicio DESC LIMIT 1`,
      [status, motivo || null, serial, empresa_id, version_nueva]
    );
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
