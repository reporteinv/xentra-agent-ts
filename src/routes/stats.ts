import express = require("express");
import { logInfo, logError, logWarn } from '../modules/logger';
import { Request, Response } from "express";
import pool = require("../db");
import { RowDataPacket } from "mysql2/promise";

const router = express.Router();

router.get("/api/pcs/:id/historial", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT fecha, mb_liberados, disco_libre_gb
      FROM pcs_historial_limpiezas WHERE pc_id=? ORDER BY fecha DESC LIMIT 50
    `,
      [req.params.id],
    );
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/stats", async (req: Request, res: Response) => {
  try {
    const [kpis] = await pool.query<RowDataPacket[]>(`
      SELECT COUNT(*) AS total_pcs,
        SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 0
          WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 0
          WHEN (disco_libre_gb / disco_total_gb) < 0.20 THEN 0 ELSE 1 END) AS activos,
        SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 0
          WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1
          WHEN (disco_libre_gb / disco_total_gb) < 0.20 THEN 1 ELSE 0 END) AS alerta,
        SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS inactivos,
        COALESCE(SUM(disco_libre_gb), 0) AS espacio_libre_total_gb,
        COALESCE(SUM(disco_total_gb), 0) AS disco_total_gb
      FROM pcs WHERE activo=1
    `);
    const [totalLiberado] = await pool.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(mb_liberados), 0) AS mb_total FROM pcs_historial_limpiezas",
    );
    const [topPcs] = await pool.query<RowDataPacket[]>(`
      SELECT p.nombre_equipo, p.usuario, COALESCE(SUM(h.mb_liberados), 0) AS total_liberado
      FROM pcs p LEFT JOIN pcs_historial_limpiezas h ON h.pc_id = p.id
      WHERE p.activo=1 GROUP BY p.id, p.nombre_equipo ORDER BY total_liberado DESC LIMIT 10
    `);
    const [porDia] = await pool.query<RowDataPacket[]>(`
      SELECT DATE(fecha) AS dia, COUNT(*) AS cantidad, COALESCE(SUM(mb_liberados), 0) AS mb_dia
      FROM pcs_historial_limpiezas WHERE fecha >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(fecha) ORDER BY dia ASC
    `);
    res.json({
      kpis: (kpis as any[])[0],
      mb_total_liberado: (totalLiberado as any[])[0].mb_total,
      top_pcs: topPcs,
      por_dia: porDia,
    });
  } catch (e: any) {
    logError("STATS_ERROR", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/stats/modelos", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT COALESCE(ma.modelo_display, p.modelo, 'Desconocido') AS modelo, COUNT(*) AS total,
        SUM(CASE WHEN p.ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1 ELSE 0 END) AS activos,
        SUM(CASE WHEN p.ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1 ELSE 0 END) AS inactivos,
        ROUND(AVG(p.disco_libre_gb), 1) AS avg_espacio_libre, ROUND(AVG(p.ram_gb), 1) AS avg_ram
      FROM pcs p LEFT JOIN modelo_alias ma ON p.modelo = ma.modelo_original
      WHERE p.activo=1 GROUP BY COALESCE(ma.modelo_display, p.modelo) ORDER BY total DESC
    `);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/stats/programas", async (req: Request, res: Response) => {
  if (!(req.session as any).autenticado)
    return res.status(401).json({ error: "No autenticado" });
  try {
    const [[totales]] = (await pool.query<RowDataPacket[]>(`
      SELECT COUNT(*) AS total_registros, COUNT(DISTINCT nombre) AS total_unicos, COUNT(DISTINCT pc_id) AS total_pcs FROM pcs_programas
    `)) as any;
    const [top10] = await pool.query<RowDataPacket[]>(`
      SELECT nombre, COUNT(DISTINCT pc_id) AS total_pcs FROM pcs_programas GROUP BY nombre ORDER BY total_pcs DESC LIMIT 10
    `);
    res.json({ totales, top10 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/stats/areas", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT CASE
        WHEN usuario LIKE '%Recepcion%' OR usuario LIKE '%alas' THEN 'Admin'
        WHEN usuario LIKE '%Asesor%' THEN 'SecGeneral'
        WHEN usuario LIKE '%Infopu%' THEN 'Comunicaciones'
        WHEN usuario LIKE '%ProyectosE%' THEN 'Reduccion'
        WHEN usuario REGEXP '_[A-Za-z]+$' THEN SUBSTRING_INDEX(usuario, '_', -1)
        ELSE 'Otros' END as area, COUNT(*) as total
      FROM pcs WHERE activo=1 GROUP BY area ORDER BY total DESC
    `);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/programas/:serial", async (req: Request, res: Response) => {
  if (!(req.session as any).autenticado)
    return res.status(401).json({ error: "No autenticado" });
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT p.nombre, p.version, p.fabricante FROM pcs_programas p
      JOIN pcs ON pcs.id = p.pc_id WHERE pcs.serial=? ORDER BY p.nombre ASC
    `,
      [req.params.serial],
    );
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/programas", async (req: Request, res: Response) => {
  try {
    const token = req.headers["x-agent-token"];
    if (token !== process.env.AGENT_TOKEN)
      return res.status(401).json({ error: "Token invalido" });
    const { serial, programas } = req.body;
    if (!serial || !programas)
      return res.status(400).json({ error: "Datos requeridos" });
    const [pc] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM pcs WHERE serial=?",
      [serial],
    );
    if (!(pc as any[]).length)
      return res.status(404).json({ error: "PC no encontrado" });
    const pc_id = (pc as any[])[0].id;
    await pool.query("DELETE FROM pcs_programas WHERE pc_id=?", [pc_id]);
    if (programas.length > 0) {
      const values = programas.map((p: any) => [
        pc_id,
        p.nombre,
        p.version || null,
        p.fabricante || null,
      ]);
      await pool.query(
        "INSERT INTO programas (pc_id, nombre, version, fabricante) VALUES ?",
        [values],
      );
    }
    res.json({ ok: true, total: programas.length });
  } catch (e: any) {
    logError("PROGRAMAS_ERROR", e.message);
    res.status(500).json({ error: e.message });
  }
});


router.get("/api/metrics", async (req: Request, res: Response) => {
  try {
    // PCs online: ultimo_reporte en los ultimos 15 min
    const [[onlineRow]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM pcs WHERE activo=1 AND ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
    ) as any;

    // Alertas 24h: comandos con estado error en ultimas 24h
    const [[alertsRow]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM pcs_comandos WHERE estado='error' AND creado >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    ) as any;

    // Ultimo backup: ultima limpieza registrada
    const [[backupRow]] = await pool.query<RowDataPacket[]>(
      `SELECT MAX(fecha) AS ultima FROM pcs_historial_limpiezas`
    ) as any;

    // Tunnel health: fetch a impresoras-ts
    let tunnelOk = false;
    try {
      const http = require('http');
      await new Promise<void>((resolve, reject) => {
        const req2 = http.get('http://localhost:3000/health', (r: any) => {
          tunnelOk = r.statusCode === 200;
          resolve();
        });
        req2.setTimeout(3000, () => { req2.destroy(); reject(); });
        req2.on('error', reject);
      });
    } catch {}

    res.json({
      pcs_online:     onlineRow.total,
      alerts_24h:     alertsRow.total,
      backup_status:  backupRow.ultima || null,
      tunnel_health:  tunnelOk,
      timestamp:      new Date().toISOString()
    });
  } catch (e: any) {
    logError("METRICS_ERROR", e.message);
    res.status(500).json({ error: e.message });
  }
});


router.get("/api/ai-score/flota", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT
        id, serial, nombre_equipo, modelo, fabricante_cpu,
        tiene_npu, npu_nombre, es_ai_ready,
        tiene_tpm, tpm_version, secure_boot, tiene_vpro,
        ram_gb, tipo_disco
      FROM pcs WHERE activo=1
    `);

    const pcs = (rows as any[]).map(pc => {
      let score = 0;
      const criterios: Record<string, boolean> = {};

      criterios.npu        = !!pc.tiene_npu;                                              if (criterios.npu)    score += 40;
      criterios.ai_ready   = !!pc.es_ai_ready;                                            if (criterios.ai_ready)  score += 20;
      criterios.vpro       = !!pc.tiene_vpro;                                             if (criterios.vpro)   score += 10;
      criterios.tpm        = !!pc.tiene_tpm && pc.tpm_version?.startsWith('2');           if (criterios.tpm)    score += 10;
      criterios.ram        = (pc.ram_gb || 0) >= 16;                                      if (criterios.ram)    score += 10;
      criterios.secure_boot= !!pc.secure_boot;                                            if (criterios.secure_boot) score += 5;
      criterios.disco_ssd  = ['SSD','NVMe','Solid State Drive'].includes(pc.tipo_disco || ''); if (criterios.disco_ssd) score += 5;

      const categoria =
        score >= 86 ? 'ai_ready' :
        score >= 61 ? 'preparado' :
        score >= 31 ? 'basico' : 'no_apto';

      return {
        id: pc.id,
        serial: pc.serial,
        nombre_equipo: pc.nombre_equipo,
        modelo: pc.modelo,
        fabricante_cpu: pc.fabricante_cpu,
        score,
        categoria,
        criterios
      };
    });

    const total = pcs.length;
    const dist = {
      no_apto:   pcs.filter(p => p.categoria === 'no_apto').length,
      basico:    pcs.filter(p => p.categoria === 'basico').length,
      preparado: pcs.filter(p => p.categoria === 'preparado').length,
      ai_ready:  pcs.filter(p => p.categoria === 'ai_ready').length,
    };
    const promedio = total > 0 ? Math.round(pcs.reduce((a, p) => a + p.score, 0) / total) : 0;
    const adopcion = {
      npu:         pcs.filter(p => p.criterios.npu).length,
      ai_ready:    pcs.filter(p => p.criterios.ai_ready).length,
      vpro:        pcs.filter(p => p.criterios.vpro).length,
      tpm:         pcs.filter(p => p.criterios.tpm).length,
      ram:         pcs.filter(p => p.criterios.ram).length,
      secure_boot: pcs.filter(p => p.criterios.secure_boot).length,
      disco_ssd:   pcs.filter(p => p.criterios.disco_ssd).length,
    };
    const ranking = [...pcs].sort((a, b) => b.score - a.score).slice(0, 20);

    res.json({ total, promedio, dist, adopcion, ranking });
  } catch (e: any) {
    logError("AI_SCORE_ERROR", e.message);
    res.status(500).json({ error: e.message });
  }
});

export = router;
