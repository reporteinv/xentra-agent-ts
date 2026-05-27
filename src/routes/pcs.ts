import express = require("express");
import { Request, Response } from "express";
import pool = require("../db");
import { RowDataPacket } from "mysql2/promise";
import path = require("path");
import archiver = require("archiver");
import fs = require("fs");
import { lookupYActualizar } from "../modules/lenovo-lookup";
import { ipLookupYActualizar } from "../modules/ip-lookup";

const router = express.Router();

function limpiarUsuario(usuario: string | null) {
  if (!usuario) return "-";
  return usuario.includes("\\") ? usuario.split("\\").pop() : usuario;
}

router.post("/api/pcs/:id/observacion", async (req: Request, res: Response) => {
  try {
    const { observacion } = req.body;
    await pool.query("UPDATE pcs SET observacion=? WHERE id=?", [
      observacion,
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/pcs/:id/color", async (req: Request, res: Response) => {
  try {
    const { color } = req.body;
    await pool.query(
      "INSERT INTO colores_pc (pc_id, color) VALUES (?,?) ON DUPLICATE KEY UPDATE color=?",
      [req.params.id, color, color],
    );
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/pcs/colores", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT pc_id, color FROM colores_pc",
    );
    const map: any = {};
    (rows as any[]).forEach((r) => (map[r.pc_id] = r.color));
    res.json(map);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/limpieza", (req: Request, res: Response) =>
  res.sendFile(path.join(__dirname, "../../public/limpieza.html")),
);

router.post("/api/reportar", async (req: Request, res: Response) => {
  try {
    const token = req.headers["x-agent-token"];
    if (token !== process.env.AGENT_TOKEN)
      return res.status(401).json({ error: "Token invalido" });
    const {
      serial,
      nombre_equipo,
      modelo,
      usuario,
      ip_local,
      espacio_libre_gb,
      espacio_total_gb,
      mb_liberados_ultima,
      ultima_limpieza,
      ram_gb,
      procesador,
      version_windows,
      disco_salud,
      disco_temp,
      disco_desgaste,
      cpu_temp,
    } = req.body;
    if (!serial || !nombre_equipo)
      return res
        .status(400)
        .json({ error: "serial y nombre_equipo son requeridos" });
    const [[aliasRow]] = (await pool.query<RowDataPacket[]>(
      "SELECT modelo_display FROM modelo_alias WHERE modelo_original=?",
      [modelo],
    )) as any;
    let modeloFinal = aliasRow ? aliasRow.modelo_display : modelo;
    if (!aliasRow && modeloFinal) {
      if (modeloFinal.includes("M75q")) modeloFinal = "M75q-1";
      else if (modeloFinal.includes("P520c")) modeloFinal = "P520c Workstation";
      else if (modeloFinal.includes("HP 240"))
        modeloFinal = "HP 240 G7 Notebook PC";
    }
    await pool.query(
      `
      INSERT INTO pcs (serial, nombre_equipo, modelo, usuario, ip_local, espacio_libre_gb,
        espacio_total_gb, mb_liberados_ultima, ultima_limpieza, ram_gb, procesador, version_windows,
        disco_salud, disco_temp, disco_desgaste, cpu_temp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        nombre_equipo=VALUES(nombre_equipo), modelo=VALUES(modelo),
        usuario=CASE WHEN VALUES(usuario) IS NOT NULL AND VALUES(usuario) != '' THEN VALUES(usuario) ELSE usuario END,
        ip_local=VALUES(ip_local), espacio_libre_gb=VALUES(espacio_libre_gb),
        espacio_total_gb=VALUES(espacio_total_gb),
        mb_liberados_ultima=COALESCE(VALUES(mb_liberados_ultima), mb_liberados_ultima),
        ultima_limpieza=COALESCE(VALUES(ultima_limpieza), ultima_limpieza),
        ram_gb=VALUES(ram_gb), procesador=VALUES(procesador),
        version_windows=VALUES(version_windows),
        disco_salud=VALUES(disco_salud), disco_temp=VALUES(disco_temp),
        disco_desgaste=VALUES(disco_desgaste), cpu_temp=VALUES(cpu_temp), ultimo_reporte=NOW()
    `,
      [
        serial,
        nombre_equipo,
        modeloFinal || null,
        usuario || null,
        ip_local || null,
        espacio_libre_gb || null,
        espacio_total_gb || null,
        mb_liberados_ultima != null ? mb_liberados_ultima : null,
        ultima_limpieza || null,
        ram_gb || null,
        procesador || null,
        version_windows || null,
        disco_salud || null,
        disco_temp != null ? disco_temp : null,
        disco_desgaste != null ? disco_desgaste : null,
        cpu_temp != null ? cpu_temp : null,
      ],
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM pcs WHERE serial=?",
      [serial],
    );
    const pcId = (rows as any[])[0]?.id;

    // Lookup garantia Lenovo en background
    if (pcId) {
      const [pcData] = await pool.query<RowDataPacket[]>(
        'SELECT lookup_status, lookup_fecha FROM pcs WHERE id=?', [pcId]);
      const pc = (pcData as any[])[0];
      const necesitaLookup = !pc?.lookup_fecha ||
        pc?.lookup_status === 'pendiente' ||
        pc?.lookup_status === 'error';
      if (necesitaLookup) {
        setImmediate(() => {
          lookupYActualizar(pcId, serial, modelo || '')
            .catch(e => console.error('[lookup]', e));
          ipLookupYActualizar(pcId, ip_local || '')
            .catch(e => console.error('[ip-lookup]', e));
        });
      }
    }

    if (pcId && mb_liberados_ultima != null) {
      await pool.query(
        "INSERT INTO historial_limpiezas (pc_id, mb_liberados, espacio_libre_gb) VALUES (?,?,?)",
        [pcId, mb_liberados_ultima, espacio_libre_gb],
      );
    }
    let comando = null;
    const [cmds] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM comandos_limpieza WHERE pc_id=? AND estado='pendiente' AND fecha_expiracion > NOW() LIMIT 1",
      [pcId],
    );
    if ((cmds as any[]).length > 0) {
      comando = "limpiar";
      await pool.query(
        "UPDATE comandos_limpieza SET estado='ejecutado', fecha_ejecucion=NOW() WHERE id=?",
        [(cmds as any[])[0].id],
      );
    }
    res.json({ ok: true, mensaje: "Reporte recibido", comando });
  } catch (err: any) {
    console.error("[Agent] Error:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

router.get("/api/pcs", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT id, serial, nombre_equipo, modelo, usuario, ip_local,
        espacio_libre_gb, espacio_total_gb, mb_liberados_ultima, ultima_limpieza,
        ultimo_reporte, usb_bloqueado, observacion,
        CASE
          WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'inactivo'
          WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 'alerta'
          WHEN (espacio_libre_gb / espacio_total_gb) < 0.20 THEN 'alerta'
          ELSE 'activo'
        END AS estado
      FROM pcs WHERE activo=1 ORDER BY ultimo_reporte DESC
    `);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: "Error consultando PCs" });
  }
});

router.get("/descargar/xentra-agent.ps1", (req: Request, res: Response) => {
  const archivo = path.join(
    __dirname,
    "../../public/downloads/xentra-agent.ps1",
  );
  res.download(archivo, "xentra-agent.ps1", (err: any) => {
    if (err) res.status(500).send("No disponible");
  });
});

router.get("/api/descargar-agente", (req: Request, res: Response) => {
  const ps1 = path.join(__dirname, "../../public/downloads/xentra-agent.ps1");
  const bat = path.join(__dirname, "../../public/downloads/setup.bat");
  if (!fs.existsSync(ps1) || !fs.existsSync(bat))
    return res.status(500).json({ error: "Archivos no disponibles" });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="Instalador.zip"');
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);
  archive.file(ps1, { name: "Instalador/xentra-agent.ps1" });
  archive.file(bat, { name: "Instalador/setup.bat" });
  archive.finalize();
});

router.get("/api/pcs/:id", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM pcs WHERE id=?",
      [req.params.id],
    );
    if (!(rows as any[]).length)
      return res.status(404).json({ error: "PC no encontrado" });
    res.json((rows as any[])[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/api/pcs/:serial", async (req: Request, res: Response) => {
  try {
    await pool.query("UPDATE pcs SET activo=0 WHERE serial=?", [
      req.params.serial,
    ]);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/pcs/:serial/usb", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT usb_bloqueado FROM pcs WHERE serial=?",
      [req.params.serial],
    );
    res.json((rows as any[])[0] || { usb_bloqueado: 0 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get(
  "/api/pcs/:serial/usb-estado",
  async (req: Request, res: Response) => {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT usb_bloqueado FROM pcs WHERE serial=?",
        [req.params.serial],
      );
      res.json((rows as any[])[0] || { usb_bloqueado: 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },
);

router.post("/api/pcs/:serial/usb", async (req: Request, res: Response) => {
  try {
    const { bloquear } = req.body;
    await pool.query("UPDATE pcs SET usb_bloqueado=? WHERE serial=?", [
      bloquear ? 1 : 0,
      req.params.serial,
    ]);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export = router;
