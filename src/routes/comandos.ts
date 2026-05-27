import express = require("express");
import { Request, Response } from "express";
import pool = require("../db");
import { RowDataPacket } from "mysql2/promise";
const router = express.Router();

// Crear comando desde el panel (sesion requerida)
router.post("/api/comandos/crear", async (req: Request, res: Response) => {
  try {
    if (!(req.session as any).autenticado)
      return res.status(401).json({ error: "No autenticado" });
    const { pc_id, comando, params } = req.body;
    if (!pc_id || !comando) return res.status(400).json({ error: "pc_id y comando requeridos" });
    await pool.query("UPDATE pcs_comandos SET estado='cancelado' WHERE pc_id=? AND estado='pendiente'", [pc_id]);
    const [result]: any = await pool.query(
      "INSERT INTO pcs_comandos (pc_id, comando, params) VALUES (?,?,?)",
      [pc_id, comando, params ? JSON.stringify(params) : null]
    );
    res.json({ ok: true, mensaje: "Comando creado", id: result.insertId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Agente consulta comandos pendientes
router.get("/api/comandos/:serial", async (req: Request, res: Response) => {
  try {
    const token = req.headers["x-agent-token"];
    if (token !== process.env.AGENT_TOKEN)
      return res.status(401).json({ error: "Token invalido" });
    const [pcs] = await pool.query<RowDataPacket[]>("SELECT id FROM pcs WHERE serial=?", [req.params.serial]);
    if (!(pcs as any[]).length) return res.json({ hay: false });
    const pcId = (pcs as any[])[0].id;
    const [cmds] = await pool.query<RowDataPacket[]>(
      "SELECT id, comando, params FROM pcs_comandos WHERE pc_id=? AND estado='pendiente' AND expira>NOW() ORDER BY creado ASC LIMIT 1",
      [pcId]);
    if (!(cmds as any[]).length) return res.json({ hay: false });
    const cmd = (cmds as any[])[0];
    await pool.query("UPDATE pcs_comandos SET estado='ejecutando' WHERE id=?", [cmd.id]);
    res.json({ hay: true, id: cmd.id, comando: cmd.comando, params: cmd.params });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Agente reporta resultado de comando
router.post("/api/comandos/resultado", async (req: Request, res: Response) => {
  try {
    const token = req.headers["x-agent-token"];
    if (token !== process.env.AGENT_TOKEN)
      return res.status(401).json({ error: "Token invalido" });
    const { id, estado, output, mb_liberados, espacio_libre_gb } = req.body;
    if (!id) return res.status(400).json({ error: "id requerido" });
    await pool.query(
      "UPDATE pcs_comandos SET estado=?, output=?, mb_liberados=?, espacio_libre_gb=?, ejecutado=NOW() WHERE id=?",
      [estado||'completado', output||null, mb_liberados||null, espacio_libre_gb||null, id]);
    if (mb_liberados != null && espacio_libre_gb != null) {
      await pool.query(
        "UPDATE pcs SET mb_liberados_ultima=?, espacio_libre_gb=?, ultima_limpieza=NOW(), ultimo_reporte=NOW() WHERE id=(SELECT pc_id FROM pcs_comandos WHERE id=?)",
        [mb_liberados, espacio_libre_gb, id]);
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Panel consulta estado de comando
router.get("/api/comandos/estado/:id", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, estado, output, ejecutado FROM pcs_comandos WHERE id=?", [req.params.id]);
    res.json((rows as any[])[0] || null);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export = router;
