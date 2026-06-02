import express = require("express");
import { Request, Response } from "express";
import pool = require("../db");
import { RowDataPacket } from "mysql2/promise";

const router = express.Router();

router.post("/api/limpiar-masivo", async (req: Request, res: Response) => {
  try {
    const [pcsActivos] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM pcs WHERE activo=1 AND ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 30 DAY)",
    );
    if (!(pcsActivos as any[]).length)
      return res.status(400).json({ error: "No hay PCs activos" });
    const [camp]: any = await pool.query(
      "INSERT INTO campanas_limpieza (total_pcs) VALUES (?)",
      [(pcsActivos as any[]).length],
    );
    const campanaId = camp.insertId;
    const valores = (pcsActivos as any[]).map((p: any) => [campanaId, p.id]);
    await pool.query(
      "INSERT INTO comandos_limpieza (campana_id, pc_id) VALUES ?",
      [valores],
    );
    // Insertar comando limpiar en pcs_comandos para que el agente lo recoja
    const expira = new Date(Date.now() + 24*60*60*1000).toISOString().slice(0,19).replace('T',' ');
    const cmdValores = (pcsActivos as any[]).map((p: any) => [p.id, 'limpiar', null, expira]);
    await pool.query(
      "INSERT INTO pcs_comandos (pc_id, comando, params, expira) VALUES ?",
      [cmdValores],
    );
    res.json({
      ok: true,
      campana_id: campanaId,
      total: (pcsActivos as any[]).length,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/limpieza/campanas", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT c.*,
        SUM(CASE WHEN cl.estado='ejecutado' THEN 1 ELSE 0 END) AS ejecutados,
        SUM(CASE WHEN cl.estado='pendiente' AND cl.fecha_expiracion > NOW() THEN 1 ELSE 0 END) AS pendientes,
        SUM(CASE WHEN cl.estado='expirado' OR (cl.estado='pendiente' AND cl.fecha_expiracion <= NOW()) THEN 1 ELSE 0 END) AS expirados
      FROM campanas_limpieza c LEFT JOIN comandos_limpieza cl ON cl.campana_id=c.id
      GROUP BY c.id ORDER BY c.fecha_creacion DESC LIMIT 10
    `);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/limpieza/detalle/:id", async (req: Request, res: Response) => {
  try {
    await pool.query(
      "UPDATE comandos_limpieza SET estado='expirado' WHERE estado='pendiente' AND fecha_expiracion <= NOW()",
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT cl.*, p.nombre_equipo, p.serial, p.modelo, p.ultimo_reporte
      FROM comandos_limpieza cl JOIN pcs p ON p.id=cl.pc_id
      WHERE cl.campana_id=? ORDER BY cl.estado ASC, cl.fecha_ejecucion DESC
    `,
      [req.params.id],
    );
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export = router;
