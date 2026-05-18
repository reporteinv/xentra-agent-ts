import express = require('express');
import { Request, Response } from 'express';
import pool = require('../db');
import { RowDataPacket } from 'mysql2/promise';

const router = express.Router();

router.post('/api/comandos/crear', async (req: Request, res: Response) => {
  try {
    if (!(req.session as any).autenticado) return res.status(401).json({ error: 'No autenticado' });
    const { pc_id } = req.body;
    if (!pc_id) return res.status(400).json({ error: 'pc_id requerido' });
    await pool.query('UPDATE comandos SET estado="cancelado" WHERE pc_id=? AND estado="pendiente"', [pc_id]);
    await pool.query('INSERT INTO comandos (pc_id, comando, estado) VALUES (?, "limpiar", "pendiente")', [pc_id]);
    res.json({ ok: true, mensaje: 'Comando creado' });
  } catch(e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/api/comandos/:serial', async (req: Request, res: Response) => {
  try {
    const token = req.headers['x-agent-token'];
    if (token !== process.env.AGENT_TOKEN) return res.status(401).json({ error: 'Token invalido' });
    const [pcs] = await pool.query<RowDataPacket[]>('SELECT id FROM pcs WHERE serial=?', [req.params.serial]);
    if (!(pcs as any[]).length) return res.json({ hay: false });
    const [cmds] = await pool.query<RowDataPacket[]>(
      'SELECT id, comando FROM comandos WHERE pc_id=? AND estado="pendiente" ORDER BY creado ASC LIMIT 1',
      [(pcs as any[])[0].id]);
    if (!(cmds as any[]).length) return res.json({ hay: false });
    await pool.query('UPDATE comandos SET estado="ejecutando" WHERE id=?', [(cmds as any[])[0].id]);
    res.json({ hay: true, id: (cmds as any[])[0].id, comando: (cmds as any[])[0].comando });
  } catch(e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/api/comandos/resultado', async (req: Request, res: Response) => {
  try {
    const token = req.headers['x-agent-token'];
    if (token !== process.env.AGENT_TOKEN) return res.status(401).json({ error: 'Token invalido' });
    const { id, estado, mb_liberados, espacio_libre_gb } = req.body;
    if (!id) return res.status(400).json({ error: 'id requerido' });
    await pool.query('UPDATE comandos SET estado=?, ejecutado=NOW(), resultado=? WHERE id=?',
      [estado||'completado', mb_liberados!=null ? mb_liberados+' MB liberados' : null, id]);
    if (mb_liberados!=null && espacio_libre_gb!=null) {
      await pool.query(
        'UPDATE pcs SET mb_liberados_ultima=?, espacio_libre_gb=?, ultima_limpieza=NOW(), ultimo_reporte=NOW() WHERE id=(SELECT pc_id FROM comandos WHERE id=?)',
        [mb_liberados, espacio_libre_gb, id]);
    }
    res.json({ ok: true });
  } catch(e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/api/comandos/estado/:pc_id', async (req: Request, res: Response) => {
  try {
    if (!(req.session as any).autenticado) return res.status(401).json({ error: 'No autenticado' });
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, estado, creado, ejecutado, resultado FROM comandos WHERE pc_id=? ORDER BY creado DESC LIMIT 1',
      [req.params.pc_id]);
    res.json((rows as any[])[0] || null);
  } catch(e: any) { res.status(500).json({ error: e.message }); }
});

export = router;
