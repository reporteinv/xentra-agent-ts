import express = require("express");
import { logInfo, logError, logWarn } from '../modules/logger';
import { Request, Response } from "express";
import pool = require("../db");
import { RowDataPacket } from "mysql2/promise";
import path = require("path");
const archiver = require("archiver").default || require("archiver");
import fs = require("fs");
import { lookupYActualizar } from "../modules/lenovo-lookup";
import { ipLookupYActualizar } from "../modules/ip-lookup";
import { emitirEvento } from '../sse';

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

router.post("/api/pc/reportar", async (req: Request, res: Response) => {
  try {
    const token = req.headers["x-agent-token"];
    if (token !== process.env.AGENT_TOKEN)
      return res.status(401).json({ error: "Token invalido" });
    const d = req.body;
    if (!d.serial || !d.empresa_id) return res.status(400).json({ error: "serial y empresa_id requeridos" });
    const empresaIdNum = parseInt(d.empresa_id);
    if (isNaN(empresaIdNum)) return res.status(400).json({ error: "empresa_id invalido" });
    d.empresa_id = empresaIdNum;
    await pool.query(`
      INSERT INTO pcs (empresa_id, serial, nombre_equipo, modelo, tipo_equipo, usuario, ip_local, mac,
        tipo_red, adaptador_red, velocidad_red, ram_gb, ram_libre_gb, marca_ram, procesador, gpu,
        motherboard, bios_version, disco_total_gb, disco_libre_gb, tipo_disco, marca_disco, bus_disco,
        disco_salud, disco_temp, disco_desgaste, cpu_temp,
        version_windows, arquitectura, win_activado, fecha_inst_so, ultimo_update, bitlocker, dominio,
        office_producto, office_version, antivirus, resolucion, impresora, uptime_horas,
        mb_liberados_ultima, ultima_limpieza, version_agente, bateria,
        garantia_status, garantia_inicio, garantia_fin, discos, monitores, ram_modulos, ultimo_reporte)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
      ON DUPLICATE KEY UPDATE
        empresa_id=VALUES(empresa_id), nombre_equipo=VALUES(nombre_equipo), modelo=VALUES(modelo), tipo_equipo=VALUES(tipo_equipo),
        usuario=CASE WHEN VALUES(usuario) IS NOT NULL AND VALUES(usuario)!='' THEN VALUES(usuario) ELSE usuario END,
        ip_local=VALUES(ip_local), mac=VALUES(mac), tipo_red=VALUES(tipo_red),
        adaptador_red=VALUES(adaptador_red), velocidad_red=VALUES(velocidad_red),
        ram_gb=VALUES(ram_gb), ram_libre_gb=VALUES(ram_libre_gb), marca_ram=VALUES(marca_ram),
        procesador=VALUES(procesador), gpu=VALUES(gpu), motherboard=VALUES(motherboard),
        bios_version=VALUES(bios_version), disco_total_gb=VALUES(disco_total_gb),
        disco_libre_gb=VALUES(disco_libre_gb), tipo_disco=VALUES(tipo_disco),
        marca_disco=VALUES(marca_disco), bus_disco=VALUES(bus_disco),
        disco_salud=VALUES(disco_salud), disco_temp=VALUES(disco_temp), disco_desgaste=VALUES(disco_desgaste), cpu_temp=VALUES(cpu_temp),
        version_windows=VALUES(version_windows), arquitectura=VALUES(arquitectura),
        win_activado=VALUES(win_activado), fecha_inst_so=VALUES(fecha_inst_so),
        ultimo_update=VALUES(ultimo_update), bitlocker=VALUES(bitlocker), dominio=VALUES(dominio),
        office_producto=VALUES(office_producto), office_version=VALUES(office_version),
        antivirus=VALUES(antivirus), resolucion=VALUES(resolucion), impresora=VALUES(impresora),
        uptime_horas=VALUES(uptime_horas),
        mb_liberados_ultima=COALESCE(VALUES(mb_liberados_ultima), mb_liberados_ultima),
        ultima_limpieza=COALESCE(VALUES(ultima_limpieza), ultima_limpieza),
        version_agente=VALUES(version_agente), bateria=VALUES(bateria),
        garantia_status=COALESCE(VALUES(garantia_status), garantia_status),
        garantia_inicio=COALESCE(VALUES(garantia_inicio), garantia_inicio),
        garantia_fin=COALESCE(VALUES(garantia_fin), garantia_fin),
        discos=COALESCE(VALUES(discos), discos),
        monitores=COALESCE(VALUES(monitores), monitores),
        ram_modulos=COALESCE(VALUES(ram_modulos), ram_modulos),
        activo=1, ultimo_reporte=NOW()
    `, [
      d.empresa_id, d.serial, d.nombre_equipo||null, d.modelo||null, d.tipo_equipo||null,
      d.usuario||null, d.ip_local||null, d.mac||null, d.tipo_red||null, d.adaptador_red||null,
      d.velocidad_red||null, d.ram_gb||null, d.ram_libre_gb||null, d.marca_ram||null,
      d.procesador||null, d.gpu||null, d.motherboard||null, d.bios_version||null,
      d.disco_total_gb||null, d.disco_libre_gb||null, d.tipo_disco||null, d.marca_disco||null,
      d.bus_disco||null, d.disco_salud||null, d.disco_temp!=null?d.disco_temp:null,
      d.disco_desgaste!=null?d.disco_desgaste:null, d.cpu_temp!=null?d.cpu_temp:null,
      d.version_windows||null, d.arquitectura||null,
      d.win_activado!=null?d.win_activado:null, d.fecha_inst_so||null, d.ultimo_update||null,
      d.bitlocker!=null?d.bitlocker:null, d.dominio||null, d.office_producto||null,
      d.office_version||null, d.antivirus||null, d.resolucion||null, d.impresora||null,
      d.uptime_horas||null, d.mb_liberados_ultima||null, d.ultima_limpieza||null,
      d.version_agente||null, d.bateria ? JSON.stringify(d.bateria) : null,
      d.garantia_status||null, d.garantia_inicio||null, d.garantia_fin||null,
      d.discos ? JSON.stringify(d.discos) : null,
      d.monitores ? JSON.stringify(d.monitores) : null,
      d.ram_modulos ? JSON.stringify(d.ram_modulos) : null
    ]);
    const [pcRows] = await pool.query<RowDataPacket[]>('SELECT id FROM pcs WHERE serial=?', [d.serial]);
    const pcId = (pcRows as any[])[0]?.id;
    if (pcId) {
      const [pcData] = await pool.query<RowDataPacket[]>(
        'SELECT lookup_status, lookup_fecha, modelo FROM pcs WHERE id=?', [pcId]);
      const pc = (pcData as any[])[0];
      const necesitaLookup = !pc?.lookup_fecha ||
        pc?.lookup_status === 'pendiente' ||
        pc?.lookup_status === 'error';
      if (necesitaLookup) {
        setImmediate(() => {
          lookupYActualizar(pcId, d.serial, d.modelo || '')
            .catch(e => logError('LOOKUP_ERROR', e.message));
          ipLookupYActualizar(pcId, d.ip_local || '')
            .catch(e => logError('IP_LOOKUP_ERROR', e.message));
        });
      }
    }
    if (pcId && d.mb_liberados_ultima) {
      await pool.query('INSERT INTO pcs_historial_limpiezas (pc_id, mb_liberados, disco_libre_gb) VALUES (?,?,?)',
        [pcId, d.mb_liberados_ultima, d.disco_libre_gb]);
    }
    // Emitir evento WebSocket a todos los clientes conectados
    if (pcId) {
      const [pcActualizado] = await pool.query<RowDataPacket[]>(
        `SELECT id, serial, nombre_equipo, modelo, usuario, ip_local,
          disco_libre_gb, disco_total_gb, mb_liberados_ultima, ultima_limpieza,
          ultimo_reporte, garantia_status,
          CASE
            WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 'inactivo'
            WHEN (disco_libre_gb / disco_total_gb) < 0.20 THEN 'alerta'
            ELSE 'activo'
          END AS estado
        FROM pcs WHERE id=?`, [pcId]
      );
      if ((pcActualizado as any[])[0]) {
        emitirEvento('pc:update', (pcActualizado as any[])[0]);
      }
    }
    res.json({ ok: true, mensaje: 'Reporte recibido' });
  } catch (err: any) {
    logError("AGENT_ERROR", err.message);
    res.status(500).json({ error: "Error interno" });
  }
});

router.get("/api/pcs", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT id, serial, nombre_equipo, modelo, usuario, ip_local,
        disco_libre_gb, disco_total_gb, mb_liberados_ultima, ultima_limpieza,
        ultimo_reporte, observacion, modelo_oficial, garantia_status, garantia_inicio, garantia_fin,
        CASE
          WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'inactivo'
          WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 'alerta'
          WHEN (disco_libre_gb / disco_total_gb) < 0.20 THEN 'alerta'
          ELSE 'activo'
        END AS estado
      FROM pcs WHERE activo=1 AND deleted_at IS NULL ORDER BY ultimo_reporte DESC
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
  try {
    const ps1 = path.join(__dirname, "../../public/downloads/xentra-agent.ps1");
    const bat = path.join(__dirname, "../../public/downloads/setup.bat");
    if (!fs.existsSync(ps1) || !fs.existsSync(bat))
      return res.status(500).json({ error: "Archivos no disponibles" });
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addLocalFile(ps1, 'Instalador');
    zip.addLocalFile(bat, 'Instalador');
    const zipBuffer = zip.toBuffer();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="Instalador.zip"');
    res.setHeader("Content-Length", zipBuffer.length);
    res.send(zipBuffer);
  } catch(e: any) {
    logError('DESCARGAR_AGENTE', e.message);
    res.status(500).json({ error: e.message });
  }
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
    await pool.query("UPDATE pcs SET activo=0, deleted_at=NOW() WHERE serial=?", [
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


// POST /api/evento-red
router.post("/api/evento-red", async (req: Request, res: Response) => {
  try {
    const token = req.headers['x-agent-token'];
    if (token !== process.env.AGENT_TOKEN) return res.status(401).json({ error: 'Token invalido' });
    const d = req.body;
    if (!d.serial) return res.status(400).json({ error: 'serial requerido' });
    const [pcRows] = await pool.query<RowDataPacket[]>('SELECT id FROM pcs WHERE serial=?', [d.serial]);
    const pcId = (pcRows as any[])[0]?.id;
    if (!pcId) return res.status(404).json({ error: 'PC no encontrado' });
    await pool.query(
      `INSERT INTO pcs_eventos_red (pc_id, adaptador, tipo, ip_anterior, ip_nueva, detalle)
       VALUES (?,?,?,?,?,?)`,
      [pcId, d.adaptador||null, d.tipo||'dhcp_fallo', d.ip_anterior||null, d.ip_nueva||null, d.detalle||null]
    );
    res.json({ ok: true });
  } catch(e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/eventos-red/:serial
router.get("/api/eventos-red/:serial", async (req: Request, res: Response) => {
  try {
    const [pcRows] = await pool.query<RowDataPacket[]>('SELECT id FROM pcs WHERE serial=?', [req.params.serial]);
    const pcId = (pcRows as any[])[0]?.id;
    if (!pcId) return res.status(404).json({ error: 'PC no encontrado' });
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT timestamp, adaptador, tipo, ip_anterior, ip_nueva, detalle
       FROM pcs_eventos_red WHERE pc_id=? ORDER BY timestamp DESC LIMIT 50`,
      [pcId]
    );
    res.json(rows);
  } catch(e: any) { res.status(500).json({ error: e.message }); }
});

export = router;
