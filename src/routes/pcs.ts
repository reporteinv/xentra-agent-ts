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
      INSERT INTO pcs (empresa_id, serial, nombre_equipo, modelo, tipo_equipo, usuario, ip_local, ip_tipo, mac,
        tipo_red, adaptador_red, velocidad_red, ram_gb, ram_libre_gb, marca_ram, procesador, gpu,
        motherboard, bios_version, disco_total_gb, disco_libre_gb, tipo_disco, marca_disco, bus_disco,
        disco_salud, disco_temp, disco_desgaste, cpu_temp,
        version_windows, arquitectura, win_activado, win_licencia, win_canal, win_clave_parcial, fecha_inst_so, ultimo_update, bitlocker, dominio,
        office_producto, office_version, antivirus, resolucion, impresora, hojas_impresas_hoy, uptime_horas,
        mb_liberados_ultima, ultima_limpieza, version_agente, bateria,
        garantia_status, garantia_inicio, garantia_fin, discos, monitores, ram_modulos,
        fabricante_cpu, tiene_npu, npu_nombre, es_ai_ready, tiene_tpm, tpm_version, secure_boot, tiene_vpro,
        cpu_uso_pct, ram_uso_pct, disco_io_pct, offline_buffered, ultimo_reporte)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
      ON DUPLICATE KEY UPDATE
        empresa_id=VALUES(empresa_id), nombre_equipo=VALUES(nombre_equipo), modelo=VALUES(modelo), tipo_equipo=VALUES(tipo_equipo),
        usuario=CASE WHEN VALUES(usuario) IS NOT NULL AND VALUES(usuario)!='' THEN VALUES(usuario) ELSE usuario END,
        ip_local=VALUES(ip_local), ip_tipo=VALUES(ip_tipo), mac=VALUES(mac), tipo_red=VALUES(tipo_red),
        adaptador_red=VALUES(adaptador_red), velocidad_red=VALUES(velocidad_red),
        ram_gb=VALUES(ram_gb), ram_libre_gb=VALUES(ram_libre_gb), marca_ram=VALUES(marca_ram),
        procesador=VALUES(procesador), gpu=VALUES(gpu), motherboard=VALUES(motherboard),
        bios_version=VALUES(bios_version), disco_total_gb=VALUES(disco_total_gb),
        disco_libre_gb=VALUES(disco_libre_gb), tipo_disco=VALUES(tipo_disco),
        marca_disco=VALUES(marca_disco), bus_disco=VALUES(bus_disco),
        disco_salud=VALUES(disco_salud), disco_temp=VALUES(disco_temp), disco_desgaste=VALUES(disco_desgaste), cpu_temp=VALUES(cpu_temp),
        version_windows=VALUES(version_windows), arquitectura=VALUES(arquitectura),
        win_activado=VALUES(win_activado), win_licencia=VALUES(win_licencia), win_canal=VALUES(win_canal), win_clave_parcial=VALUES(win_clave_parcial), fecha_inst_so=VALUES(fecha_inst_so),
        ultimo_update=VALUES(ultimo_update), bitlocker=VALUES(bitlocker), dominio=VALUES(dominio),
        office_producto=VALUES(office_producto), office_version=VALUES(office_version),
        antivirus=VALUES(antivirus), resolucion=VALUES(resolucion), impresora=VALUES(impresora), hojas_impresas_hoy=VALUES(hojas_impresas_hoy),
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
        fabricante_cpu=VALUES(fabricante_cpu), tiene_npu=VALUES(tiene_npu), npu_nombre=VALUES(npu_nombre),
        es_ai_ready=VALUES(es_ai_ready), tiene_tpm=VALUES(tiene_tpm), tpm_version=VALUES(tpm_version),
        secure_boot=VALUES(secure_boot), tiene_vpro=VALUES(tiene_vpro),
        cpu_uso_pct=COALESCE(VALUES(cpu_uso_pct), cpu_uso_pct),
        ram_uso_pct=COALESCE(VALUES(ram_uso_pct), ram_uso_pct),
        disco_io_pct=COALESCE(VALUES(disco_io_pct), disco_io_pct),
        offline_buffered=VALUES(offline_buffered),
        activo=1, ultimo_reporte=NOW()
    `, [
      d.empresa_id, d.serial, d.nombre_equipo||null, d.modelo||null, d.tipo_equipo||null,
      d.usuario||null, d.ip_local||null, d.ip_tipo||null, d.mac||null, d.tipo_red||null, d.adaptador_red||null,
      d.velocidad_red||null, d.ram_gb||null, d.ram_libre_gb||null, d.marca_ram||null,
      d.procesador||null, d.gpu||null, d.motherboard||null, d.bios_version||null,
      d.disco_total_gb||null, d.disco_libre_gb||null, d.tipo_disco||null, d.marca_disco||null,
      d.bus_disco||null, d.disco_salud||null, d.disco_temp!=null?d.disco_temp:null,
      d.disco_desgaste!=null?d.disco_desgaste:null, d.cpu_temp!=null?d.cpu_temp:null,
      d.version_windows||null, d.arquitectura||null,
      d.win_activado!=null?d.win_activado:null, d.win_licencia||null, d.win_canal||null, d.win_clave_parcial||null, d.fecha_inst_so||null, d.ultimo_update||null,
      d.bitlocker!=null?d.bitlocker:null, d.dominio||null, d.office_producto||null,
      d.office_version||null, d.antivirus||null, d.resolucion||null, d.impresora||null, d.hojas_impresas_hoy||0,
      d.uptime_horas||null, d.mb_liberados_ultima||null, d.ultima_limpieza||null,
      d.version_agente||null, d.bateria ? JSON.stringify(d.bateria) : null,
      d.garantia_status||null, d.garantia_inicio||null, d.garantia_fin||null,
      d.discos ? JSON.stringify(d.discos) : null,
      d.monitores ? JSON.stringify(d.monitores) : null,
      d.ram_modulos ? JSON.stringify(d.ram_modulos) : null,
      d.fabricante_cpu||null, d.tiene_npu!=null?d.tiene_npu:null, d.npu_nombre||null,
      d.es_ai_ready!=null?d.es_ai_ready:null, d.tiene_tpm!=null?d.tiene_tpm:null,
      d.tpm_version||null, d.secure_boot!=null?d.secure_boot:null, d.tiene_vpro!=null?d.tiene_vpro:null,
      d.cpu_uso_pct!=null?d.cpu_uso_pct:null, d.ram_uso_pct!=null?d.ram_uso_pct:null,
      d.disco_io_pct!=null?d.disco_io_pct:null, d.offline_buffered||0
    ]);
    const [pcRows] = await pool.query<RowDataPacket[]>('SELECT id FROM pcs WHERE serial=?', [d.serial]);
    const pcId = (pcRows as any[])[0]?.id;
    if (pcId) {
      const [pcData] = await pool.query<RowDataPacket[]>(
        'SELECT lookup_status, lookup_fecha, modelo FROM pcs p LEFT JOIN modelo_alias ma ON p.modelo = ma.modelo_original WHERE p.id=?', [pcId]);
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
        `SELECT p.id, p.serial, p.nombre_equipo, COALESCE(ma.modelo_display, p.modelo) AS modelo, p.usuario, p.ip_local, p.ip_tipo,
          p.disco_libre_gb, p.disco_total_gb, p.mb_liberados_ultima, p.ultima_limpieza,
          p.ultimo_reporte, p.garantia_status,
          CASE
            WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 'inactivo'
            WHEN (disco_libre_gb / disco_total_gb) < 0.20 THEN 'alerta'
            ELSE 'activo'
          END AS estado
        FROM pcs p LEFT JOIN modelo_alias ma ON p.modelo = ma.modelo_original WHERE p.id=?`, [pcId]
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
      SELECT p.id, p.serial, p.nombre_equipo, COALESCE(ma.modelo_display, p.modelo) AS modelo, p.usuario, p.ip_local, p.ip_tipo,
        p.disco_libre_gb, p.disco_total_gb, p.mb_liberados_ultima, p.ultima_limpieza,
        p.ultimo_reporte, p.observacion, p.modelo_oficial, p.garantia_status, p.garantia_inicio, p.garantia_fin,
        CASE
          WHEN p.ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'inactivo'
          WHEN p.ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 'alerta'
          WHEN (p.disco_libre_gb / p.disco_total_gb) < 0.20 THEN 'alerta'
          ELSE 'activo'
        END AS estado
      FROM pcs p LEFT JOIN modelo_alias ma ON p.modelo = ma.modelo_original WHERE p.activo=1 AND p.deleted_at IS NULL ORDER BY p.ultimo_reporte DESC
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
      "SELECT p.*, COALESCE(ma.modelo_display, p.modelo) AS modelo, COALESCE((SELECT SUM(paginas) FROM snmp_trabajos_impresion WHERE serial_pc = CONVERT(p.serial USING utf8mb4) COLLATE utf8mb4_general_ci AND MONTH(fecha) = MONTH(NOW()) AND YEAR(fecha) = YEAR(NOW())), 0) AS hojas_mes FROM pcs p LEFT JOIN modelo_alias ma ON p.modelo = ma.modelo_original WHERE p.id=?",
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

router.get('/api/pc/comando-limpieza/:serial', async (req: Request, res: Response) => {
  try {
    const token = req.headers['x-agent-token'];
    if (token !== process.env.AGENT_TOKEN) return res.status(401).json({ error: 'Token invalido' });
    const [pcRows] = await pool.query<RowDataPacket[]>('SELECT id FROM pcs WHERE serial=? AND activo=1', [req.params.serial]);
    const pc = (pcRows as any[])[0];
    if (!pc) return res.json({ limpiar: false });
    const [cmdRows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM comandos_limpieza
       WHERE pc_id=? AND estado='pendiente' AND (fecha_expiracion IS NULL OR fecha_expiracion > NOW())
       LIMIT 1`,
      [pc.id]
    );
    const cmd = (cmdRows as any[])[0];
    if (!cmd) return res.json({ limpiar: false });
    await pool.query("UPDATE comandos_limpieza SET estado='ejecutado', fecha_ejecucion=NOW() WHERE id=?", [cmd.id]);
    res.json({ limpiar: true, comando_id: cmd.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ENDPOINT: recibir programas del agente
router.post("/api/pc/programas", async (req: Request, res: Response) => {
  try {
    const token = req.headers["x-agent-token"];
    if (token !== process.env.AGENT_TOKEN)
      return res.status(401).json({ error: "Token invalido" });
    const { serial, programas } = req.body;
    if (!serial || !programas)
      return res.status(400).json({ error: "Datos requeridos" });
    const [pcRows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM pcs WHERE serial=?", [serial]
    );
    if (!pcRows.length)
      return res.status(404).json({ error: "PC no encontrado" });
    const pc_id = pcRows[0].id;
    await pool.query("DELETE FROM pcs_programas WHERE pc_id=?", [pc_id]);
    if (programas.length > 0) {
      const values = programas.map((p: any) => [
        pc_id, p.nombre, p.version || null, p.fabricante || null
      ]);
      await pool.query(
        "INSERT INTO pcs_programas (pc_id, nombre, version, fabricante) VALUES ?",
        [values]
      );
    }
    res.json({ ok: true, total: programas.length });
  } catch (err: any) {
    res.status(500).json({ error: "Error interno" });
  }
});

// ENDPOINT: obtener programas de un PC
router.get("/api/programas/:serial", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT pp.nombre, pp.version, pp.fabricante
       FROM pcs_programas pp
       JOIN pcs p ON pp.pc_id = p.id
       WHERE p.serial = ?
       ORDER BY pp.nombre ASC`,
      [req.params.serial]
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: "Error interno" });
  }
});
