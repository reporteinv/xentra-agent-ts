const express = require("express");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const helmet = require("helmet");
const path = require("path");
const db = require("./db");
require("dotenv").config();
const session = require("express-session");
const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.use(express.json({ limit: "100kb" }));

// ============================================
// SESION Y AUTH
// ============================================

app.use(
  session({
    secret: "xentra_agent_ungrd_2026",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 horas
  }),
);

const USUARIO = "Ungrd";
const PASSWORD = "Ungrd.2026";

function requireAuth(req, res, next) {
  // El agente siempre puede reportar (usa token)
  if (req.path === "/api/reportar") return next();
  if (req.path.startsWith("/api/comandos/") && req.method === "GET")
    return next();
  if (req.path === "/api/comandos/resultado") return next();
  if (req.method === "DELETE" && req.path.startsWith("/api/pcs/"))
    return next();
  if (req.path === "/api/programas") return next();
  if (req.path === "/api/stats/areas") return next();
  if (req.path === "/api/descargar-agente") return next();
  if (req.method === "GET" && req.path.match(/\/api\/pcs\/[^\/]+\/usb/))
    return next();
  // Login page siempre accesible
  if (
    req.path === "/login.html" ||
    req.path === "/api/login" ||
    req.path === "/api/logout"
  )
    return next();
  // Archivos estáticos de login
  if (req.path === "/favicon.ico") return next();
  if (req.path.startsWith("/assets/")) return next();
  // Verificar sesión
  if (!req.session.autenticado) {
    if (req.path.startsWith("/api/"))
      return res.status(401).json({ error: "No autenticado" });
    return res.redirect("/login.html");
  }
  next();
}

app.use(requireAuth);

app.post("/api/login", express.urlencoded({ extended: true }), (req, res) => {
  const { usuario, password } = req.body;
  if (usuario === USUARIO && password === PASSWORD) {
    req.session.autenticado = true;
    return res.redirect("/");
  }
  res.redirect("/login.html?error=1");
});

app.get("/api/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login.html");
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/pcs/:id/observacion", async (req, res) => {
  try {
    const { observacion } = req.body;
    await db.query("UPDATE pcs SET observacion=? WHERE id=?", [
      observacion,
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/pcs/:id/color", async (req, res) => {
  try {
    const { color } = req.body;
    await db.query(
      "INSERT INTO colores_pc (pc_id, color) VALUES (?,?) ON DUPLICATE KEY UPDATE color=?",
      [req.params.id, color, color],
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/pcs/colores", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT pc_id, color FROM colores_pc");
    const map = {};
    rows.forEach((r) => (map[r.pc_id] = r.color));
    res.json(map);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/limpieza", (req, res) =>
  res.sendFile(path.join(__dirname, "public/limpieza.html")),
);

// ============================================
// ENDPOINT: recibe reportes de los agentes
// ============================================
app.post("/api/reportar", async (req, res) => {
  try {
    const token = req.headers["x-agent-token"];
    if (token !== process.env.AGENT_TOKEN) {
      return res.status(401).json({ error: "Token invalido" });
    }

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
    } = req.body;

    if (!serial || !nombre_equipo) {
      return res
        .status(400)
        .json({ error: "serial y nombre_equipo son requeridos" });
    }
    const [[aliasRow]] = await db.query(
      "SELECT modelo_display FROM modelo_alias WHERE modelo_original=?",
      [modelo],
    );
    let modeloFinal = aliasRow ? aliasRow.modelo_display : modelo;
    // Normalización por patrón
    if (!aliasRow && modeloFinal) {
      if (modeloFinal.includes("M75q")) modeloFinal = "M75q-1";
      else if (modeloFinal.includes("P520c")) modeloFinal = "P520c Workstation";
      else if (modeloFinal.includes("HP 240"))
        modeloFinal = "HP 240 G7 Notebook PC";
    }

    await db.query(
      `
      INSERT INTO pcs 
        (serial, nombre_equipo, modelo, usuario, ip_local, espacio_libre_gb,
         espacio_total_gb, mb_liberados_ultima, ultima_limpieza,
         ram_gb, procesador, version_windows)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        nombre_equipo = VALUES(nombre_equipo),
        modelo = VALUES(modelo),
        usuario = CASE WHEN VALUES(usuario) IS NOT NULL AND VALUES(usuario) != '' THEN VALUES(usuario) ELSE usuario END,
        ip_local = VALUES(ip_local),
        espacio_libre_gb = VALUES(espacio_libre_gb),
        espacio_total_gb = VALUES(espacio_total_gb),
        mb_liberados_ultima = COALESCE(VALUES(mb_liberados_ultima), mb_liberados_ultima),
        ultima_limpieza = COALESCE(VALUES(ultima_limpieza), ultima_limpieza),
        ram_gb = VALUES(ram_gb),
        procesador = VALUES(procesador),
        version_windows = VALUES(version_windows),
        ultimo_reporte = NOW()
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
      ],
    );

    const [rows] = await db.query("SELECT id FROM pcs WHERE serial = ?", [
      serial,
    ]);
    const pcId = rows[0]?.id;

    if (pcId && mb_liberados_ultima != null) {
      await db.query(
        `
        INSERT INTO historial_limpiezas (pc_id, mb_liberados, espacio_libre_gb)
        VALUES (?, ?, ?)
      `,
        [pcId, mb_liberados_ultima, espacio_libre_gb],
      );
    }

    // Verificar si hay comando de limpieza pendiente
    let comando = null;
    const [cmds] = await db.query(
      "SELECT id FROM comandos_limpieza WHERE pc_id=? AND estado='pendiente' AND fecha_expiracion > NOW() LIMIT 1",
      [rows[0]?.id],
    );
    if (cmds.length > 0) {
      comando = "limpiar";
      await db.query(
        "UPDATE comandos_limpieza SET estado='ejecutado', fecha_ejecucion=NOW() WHERE id=?",
        [cmds[0].id],
      );
    }
    res.json({ ok: true, mensaje: "Reporte recibido", comando });
  } catch (err) {
    console.error("[Agent] Error:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

// ============================================
// ENDPOINT: listar PCs
// ============================================

function limpiarUsuario(usuario) {
  if (!usuario) return "-";
  return usuario.includes("\\") ? usuario.split("\\").pop() : usuario;
}

app.get("/api/pcs", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, serial, nombre_equipo, modelo, usuario, ip_local,
      espacio_libre_gb, espacio_total_gb,
             mb_liberados_ultima, ultima_limpieza, ultimo_reporte, usb_bloqueado,
             CASE 
      WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'inactivo'
      WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 'alerta'
      WHEN (espacio_libre_gb / espacio_total_gb) < 0.20 THEN 'alerta'
      ELSE 'activo'
      END AS estado
      FROM pcs
      WHERE activo = 1
      ORDER BY ultimo_reporte DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error consultando PCs" });
  }
});

// ============================================

// ENDPOINT: descargar PS1 publico (solo el script)
app.get("/descargar/xentra-agent.ps1", (req, res) => {
  const archivo = __dirname + "/public/downloads/xentra-agent.ps1";
  res.download(archivo, "xentra-agent.ps1", (err) => {
    if (err) res.status(500).send("No disponible");
  });
});

// ENDPOINT: descargar agente (ZIP dinamico)
const archiver = require("archiver");
app.get("/api/descargar-agente", (req, res) => {
  const ps1 = __dirname + "/public/downloads/xentra-agent.ps1";
  const bat = __dirname + "/public/downloads/setup.bat";
  const fs = require("fs");
  if (!fs.existsSync(ps1) || !fs.existsSync(bat)) {
    return res.status(500).json({ error: "Archivos no disponibles" });
  }
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="Instalador.zip"');
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);
  archive.file(ps1, { name: "Instalador/xentra-agent.ps1" });
  archive.file(bat, { name: "Instalador/setup.bat" });
  archive.finalize();
});

// ENDPOINT: detalle de un PC por id
app.get("/api/pcs/:id", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM pcs WHERE id = ?", [
      req.params.id,
    ]);
    if (!rows.length)
      return res.status(404).json({ error: "PC no encontrado" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ENDPOINT: historial de un PC
// ============================================
app.get("/api/pcs/:id/historial", async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT fecha, mb_liberados, espacio_libre_gb
      FROM historial_limpiezas
      WHERE pc_id = ?
      ORDER BY fecha DESC
      LIMIT 50
    `,
      [req.params.id],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error" });
  }
});

// ============================================
// ENDPOINT: estadisticas globales para dashboard
// ============================================
app.get("/api/stats", async (req, res) => {
  try {
    // KPIs principales
    const [kpis] = await db.query(`
      SELECT 
        COUNT(*) AS total_pcs,
          SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 0
          WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 0
          WHEN (espacio_libre_gb / espacio_total_gb) < 0.20 THEN 0
          ELSE 1 END) AS activos,
          SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 0
          WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1
          WHEN (espacio_libre_gb / espacio_total_gb) < 0.20 THEN 1
          ELSE 0 END) AS alerta,
          SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS inactivos,        
        COALESCE(SUM(espacio_libre_gb), 0) AS espacio_libre_total_gb,
        COALESCE(SUM(espacio_total_gb), 0) AS espacio_total_gb
      FROM pcs
      WHERE activo = 1
    `);

    // Total MB liberados histórico (suma de todas las limpiezas)
    const [totalLiberado] = await db.query(`
      SELECT COALESCE(SUM(mb_liberados), 0) AS mb_total
      FROM historial_limpiezas
    `);

    // Top 10 PCs con más MB liberados acumulados
    const [topPcs] = await db.query(`
      SELECT p.nombre_equipo, p.usuario, COALESCE(SUM(h.mb_liberados), 0) AS total_liberado
      FROM pcs p
      LEFT JOIN historial_limpiezas h ON h.pc_id = p.id
      WHERE p.activo = 1
      GROUP BY p.id, p.nombre_equipo
      ORDER BY total_liberado DESC
      LIMIT 10
    `);

    // Limpiezas por día (últimos 30 días)
    const [porDia] = await db.query(`
      SELECT DATE(fecha) AS dia, 
             COUNT(*) AS cantidad,
             COALESCE(SUM(mb_liberados), 0) AS mb_dia
      FROM historial_limpiezas
      WHERE fecha >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(fecha)
      ORDER BY dia ASC
    `);

    res.json({
      kpis: kpis[0],
      mb_total_liberado: totalLiberado[0].mb_total,
      top_pcs: topPcs,
      por_dia: porDia,
    });
  } catch (err) {
    console.error("[Stats] Error:", err);
    res.status(500).json({ error: "Error generando estadisticas" });
  }
});

// ============================================
// ENDPOINT: limpieza masiva
// ============================================
app.post("/api/limpiar-masivo", async (req, res) => {
  try {
    const [pcsActivos] = await db.query(
      "SELECT id FROM pcs WHERE activo=1 AND ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 30 DAY)",
    );
    if (pcsActivos.length === 0)
      return res.status(400).json({ error: "No hay PCs activos" });
    const [camp] = await db.query(
      "INSERT INTO campanas_limpieza (total_pcs) VALUES (?)",
      [pcsActivos.length],
    );
    const campanaId = camp.insertId;
    const valores = pcsActivos.map((p) => [campanaId, p.id]);
    await db.query(
      "INSERT INTO comandos_limpieza (campana_id, pc_id) VALUES ?",
      [valores],
    );
    res.json({ ok: true, campana_id: campanaId, total: pcsActivos.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/limpieza/campanas", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT c.*,
        SUM(CASE WHEN cl.estado='ejecutado' THEN 1 ELSE 0 END) AS ejecutados,
        SUM(CASE WHEN cl.estado='pendiente' AND cl.fecha_expiracion > NOW() THEN 1 ELSE 0 END) AS pendientes,
        SUM(CASE WHEN cl.estado='expirado' OR (cl.estado='pendiente' AND cl.fecha_expiracion <= NOW()) THEN 1 ELSE 0 END) AS expirados
      FROM campanas_limpieza c
      LEFT JOIN comandos_limpieza cl ON cl.campana_id = c.id
      GROUP BY c.id
      ORDER BY c.fecha_creacion DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/limpieza/detalle/:id", async (req, res) => {
  try {
    await db.query(
      "UPDATE comandos_limpieza SET estado='expirado' WHERE estado='pendiente' AND fecha_expiracion <= NOW()",
    );
    const [rows] = await db.query(
      `
      SELECT cl.*, p.nombre_equipo, p.serial, p.modelo, p.ultimo_reporte
      FROM comandos_limpieza cl
      JOIN pcs p ON p.id = cl.pc_id
      WHERE cl.campana_id = ?
      ORDER BY cl.estado ASC, cl.fecha_ejecucion DESC
    `,
      [req.params.id],
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// ENDPOINT: stats por modelo
// ============================================
app.get("/api/stats/modelos", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        COALESCE(modelo, 'Desconocido') AS modelo,
        COUNT(*) AS total,
        SUM(CASE WHEN ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1 ELSE 0 END) AS activos,
        SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1 ELSE 0 END) AS inactivos,
        ROUND(AVG(espacio_libre_gb), 1) AS avg_espacio_libre,
        ROUND(AVG(ram_gb), 1) AS avg_ram
      FROM pcs
      WHERE activo = 1
      GROUP BY modelo
      ORDER BY total DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ENDPOINT: exportar PCs a Excel
// ============================================
app.get("/api/export/excel", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT nombre_equipo, serial, modelo, usuario, ip_local,
      espacio_libre_gb, espacio_total_gb,
             mb_liberados_ultima, ultima_limpieza,
             ram_gb, procesador, version_windows, ultimo_reporte, usb_bloqueado,
             CASE 
               WHEN ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 'Activo'
               WHEN ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'Alerta'
               ELSE 'Inactivo'
             END AS estado
      FROM pcs WHERE activo = 1
      ORDER BY ultimo_reporte DESC
    `);

    const wb = new ExcelJS.Workbook();
    wb.creator = "Xentra-Agent";
    wb.created = new Date();

    const ws = wb.addWorksheet("PCs Monitoreados");

    ws.columns = [
      { header: "Estado", key: "estado", width: 12 },
      { header: "Serial", key: "serial", width: 20 },
      { header: "Modelo", key: "modelo", width: 25 },
      { header: "Usuario", key: "usuario_limpio", width: 30 },
      { header: "IP", key: "ip_local", width: 16 },
      { header: "Disco libre (GB)", key: "espacio_libre_gb", width: 16 },
      { header: "Disco total (GB)", key: "espacio_total_gb", width: 16 },
      { header: "GB liberados", key: "mb_liberados_ultima", width: 14 },
      { header: "Última limpieza", key: "ultima_limpieza", width: 20 },
      { header: "Procesador", key: "procesador", width: 35 },
      { header: "RAM (GB)", key: "ram_gb", width: 12 },
      { header: "Windows", key: "version_windows", width: 14 },
    ];

    // Formato del encabezado
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF34495E" },
    };
    ws.getRow(1).alignment = { vertical: "middle", horizontal: "left" };

    // Filas
    rows.forEach((r) =>
      ws.addRow({
        estado: r.estado,
        serial: r.serial,
        modelo: r.modelo || "-",
        usuario_limpio: limpiarUsuario(r.usuario),
        ip_local: r.ip_local,
        espacio_libre_gb: r.espacio_libre_gb
          ? Math.round(r.espacio_libre_gb)
          : null,
        espacio_total_gb: r.espacio_total_gb
          ? Math.round(r.espacio_total_gb)
          : null,
        mb_liberados_ultima:
          r.mb_liberados_ultima != null
            ? parseFloat((r.mb_liberados_ultima / 1024).toFixed(1))
            : null,
        ultima_limpieza: r.ultima_limpieza
          ? new Date(r.ultima_limpieza).toLocaleDateString("es-CO")
          : null,
        procesador: r.procesador || "-",
        ram_gb: r.ram_gb ? parseFloat(r.ram_gb) : null,
        version_windows: r.version_windows || "-",
      }),
    );

    // Colorear estado
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const estado = row.getCell("estado").value;
      let color = "FFD4EDDA";
      if (estado === "Alerta") color = "FFFFF3CD";
      if (estado === "Inactivo") color = "FFF8D7DA";
      row.getCell("estado").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: color },
      };
    });

    // Congelar header
    ws.views = [{ state: "frozen", ySplit: 1 }];

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="reporte_${fecha}.xlsx"`,
    );

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[Excel] Error:", err);
    res.status(500).json({ error: "Error generando Excel" });
  }
});

// ============================================
// ENDPOINT: exportar PCs a PDF
// ============================================
app.get("/api/export/pdf", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT nombre_equipo, serial, modelo, usuario, ip_local,
      espacio_libre_gb, espacio_total_gb,
             mb_liberados_ultima, ultima_limpieza,
             ram_gb, procesador, version_windows,
             CASE 
               WHEN ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 'Activo'
               WHEN ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'Alerta'
               ELSE 'Inactivo'
             END AS estado
      FROM pcs WHERE activo = 1
      ORDER BY ultimo_reporte DESC
    `);

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="reporte_${fecha}.pdf"`,
    );

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 30,
    });
    doc.pipe(res);
    const logoPath = __dirname + "/public/assets/logo-ungrd.png";
    try {
      doc.image(logoPath, 760, 5, { width: 65, height: 65 });
    } catch (e) {
      console.log("Logo err:", e.message);
    }

    // Título
    doc.fontSize(18).fillColor("#2c3e50").text("Reporte", { align: "center" });
    doc
      .fontSize(10)
      .fillColor("#7f8c8d")
      .text(
        `Generado: ${new Date().toLocaleString("es-CO")} | Total: ${rows.length} PCs`,
        { align: "center" },
      );
    doc.moveDown(1);

    // Encabezado tabla
    const headers = [
      "Estado",
      "Serial",
      "Modelo",
      "Procesador",
      "RAM",
      "Windows",
      "Usuario",
      "IP",
      "Disco libre",
      "GB liber.",
      "Últ. limpieza",
    ];
    const widths = [42, 75, 95, 112, 38, 48, 80, 62, 72, 48, 80];
    let y = doc.y;
    let x = 30;

    doc.fontSize(9).fillColor("#ffffff");
    doc
      .rect(
        30,
        y,
        widths.reduce((a, b) => a + b, 0),
        20,
      )
      .fill("#34495e");
    doc.fillColor("#ffffff");
    headers.forEach((h, i) => {
      doc.text(h, x, y + 7, { width: widths[i], align: "center" });
      x += widths[i];
    });
    y += 20;

    // Filas
    doc.fontSize(8);
    rows.forEach((r, idx) => {
      if (y > 520) {
        doc.addPage();
        try {
          doc.image(logoPath, 760, 5, { width: 65, height: 65 });
        } catch (e) {}
        // Encabezado en nueva página
        doc
          .fontSize(18)
          .fillColor("#2c3e50")
          .text("Reporte", { align: "center" });
        doc
          .fontSize(10)
          .fillColor("#7f8c8d")
          .text(
            `Generado: ${new Date().toLocaleString("es-CO")} | Total: ${rows.length} PCs`,
            { align: "center" },
          );
        doc.moveDown(0.5);
        // Repetir header tabla
        let xh = 30;
        const ny = doc.y;
        doc
          .rect(
            30,
            ny,
            widths.reduce((a, b) => a + b, 0),
            20,
          )
          .fill("#34495e");
        doc.fontSize(9).fillColor("#ffffff");
        headers.forEach((h, i) => {
          doc.text(h, xh, ny + 7, { width: widths[i], align: "center" });
          xh += widths[i];
        });
        y = ny + 20;
        doc.fontSize(8);
      }

      // Fondo alternado
      if (idx % 2 === 0) {
        doc
          .rect(
            30,
            y,
            widths.reduce((a, b) => a + b, 0),
            18,
          )
          .fill("#f9fafb");
      }

      // Color del estado
      let colorEstado = "#27ae60";
      if (r.estado === "Alerta") colorEstado = "#f39c12";
      if (r.estado === "Inactivo") colorEstado = "#e74c3c";

      x = 30;
      const cells = [
        { text: r.estado, color: colorEstado },
        { text: r.serial || "-" },
        { text: (r.modelo || "-").substring(0, 18) },
        { text: (r.procesador || "-").substring(0, 22) },
        { text: r.ram_gb ? r.ram_gb + " GB" : "-" },
        { text: r.version_windows || "-" },
        { text: limpiarUsuario(r.usuario).substring(0, 20) },
        { text: r.ip_local || "-" },
        {
          text: r.espacio_libre_gb
            ? `BARRA:${r.espacio_libre_gb}:${r.espacio_total_gb}`
            : "-",
        },
        {
          text: r.mb_liberados_ultima
            ? `${(r.mb_liberados_ultima / 1024).toFixed(1)} GB`
            : "-",
        },
        {
          text: r.ultima_limpieza
            ? new Date(r.ultima_limpieza).toLocaleString("es-CO", {
                dateStyle: "short",
                timeStyle: "short",
              })
            : "-",
        },
      ];

      cells.forEach((c, i) => {
        if (c.text && c.text.startsWith("BARRA:")) {
          const parts = c.text.split(":");
          const libre = parseFloat(parts[1]);
          const total = parseFloat(parts[2]);
          const pct = Math.round((libre / total) * 100);
          const barW = widths[i] - 12;
          const barH = 6;
          const barY = y + 3;
          // fondo gris
          doc.rect(x + 4, barY, barW, barH).fill("#ecf0f1");
          // barra coloreada
          const color = pct < 20 ? "#e74c3c" : pct < 40 ? "#f39c12" : "#27ae60";
          doc
            .rect(x + 4, barY, Math.round((barW * pct) / 100), barH)
            .fill(color);
          // texto
          doc.fillColor("#2c3e50").fontSize(7);
          doc.text(`${pct}%`, x, barY + 8, {
            width: widths[i],
            align: "center",
          });
          doc.fontSize(8);
        } else {
          doc.fillColor(c.color || "#2c3e50");
          doc.text(c.text, x, y + 7, {
            width: widths[i],
            align: "center",
            ellipsis: true,
          });
        }
        x += widths[i];
      });

      y += 22;
    });

    // ============================================
    // GRAFICO DE BARRAS - Top PCs por GB liberados
    // ============================================
    doc.addPage();
    doc
      .fontSize(16)
      .fillColor("#2c3e50")
      .text("Top PCs — GB Liberados Acumulados", 30, doc.y, {
        width: 752,
        align: "center",
      });
    doc.moveDown(0.5);
    doc
      .fontSize(9)
      .fillColor("#7f8c8d")
      .text(`Generado: ${new Date().toLocaleString("es-CO")}`, {
        align: "center",
      });
    doc.moveDown(1);

    // Obtener top 10 por mb_liberados_ultima
    const topPcs = [...rows]
      .filter((r) => r.mb_liberados_ultima > 0)
      .sort((a, b) => b.mb_liberados_ultima - a.mb_liberados_ultima)
      .slice(0, 10);

    if (topPcs.length > 0) {
      const maxVal = topPcs[0].mb_liberados_ultima;
      const chartX = 180;
      const chartW = 500;
      const barH = 22;
      const gap = 8;
      let chartY = doc.y;

      topPcs.forEach((pc, idx) => {
        const pct = pc.mb_liberados_ultima / maxVal;
        const bW = Math.round(chartW * pct);
        const gb = (pc.mb_liberados_ultima / 1024).toFixed(1);
        const color = pct > 0.6 ? "#3498db" : pct > 0.3 ? "#2980b9" : "#85c1e9";

        // Etiqueta serial
        doc.fontSize(8).fillColor("#2c3e50");
        doc.text(
          pc.usuario ? pc.usuario.split("\\").pop() : pc.serial || "-",
          chartX - 90,
          chartY + 6,
          { width: 85, align: "right" },
        );

        // Fondo barra
        doc.rect(chartX, chartY, chartW, barH).fill("#ecf0f1");

        // Barra coloreada
        doc.rect(chartX, chartY, bW, barH).fill(color);

        // Valor GB
        doc.fontSize(8).fillColor("#ffffff");
        if (bW > 40) {
          doc.text(`${gb} GB`, chartX + bW - 40, chartY + 7, {
            width: 38,
            align: "right",
          });
        } else {
          doc.fillColor("#2c3e50");
          doc.text(`${gb} GB`, chartX + bW + 4, chartY + 7, { width: 40 });
        }

        chartY += barH + gap;
      });
    } else {
      doc
        .fontSize(12)
        .fillColor("#999999")
        .text("Sin datos de limpiezas registradas", { align: "center" });
    }

    // ============================================
    // PAGINA: Top 10 programas más instalados
    // ============================================
    const [topProgramas] = await db.query(`
      SELECT nombre, COUNT(DISTINCT pc_id) AS total_pcs
      FROM programas
      GROUP BY nombre
      ORDER BY total_pcs DESC
      LIMIT 10
    `);
    if (topProgramas.length > 0) {
      doc.addPage();
      try {
        doc.image(logoPath, 760, 5, { width: 65, height: 65 });
      } catch (e) {}
      doc
        .fontSize(16)
        .fillColor("#2c3e50")
        .text("Top 10 — Programas más instalados", 30, doc.y, {
          width: 752,
          align: "center",
        });
      doc.moveDown(0.5);
      doc
        .fontSize(9)
        .fillColor("#7f8c8d")
        .text(`Generado: ${new Date().toLocaleString("es-CO")}`, {
          align: "center",
        });
      doc.moveDown(1);
      const maxPcs = topProgramas[0].total_pcs;
      const chartX = 250;
      const chartW = 480;
      const barH = 20;
      let chartY = doc.y;
      topProgramas.forEach((p) => {
        const pct = p.total_pcs / maxPcs;
        const bW = Math.round(chartW * pct);
        const nombre =
          p.nombre.length > 38 ? p.nombre.substring(0, 38) + "…" : p.nombre;
        doc.fontSize(8).fillColor("#2c3e50");
        doc.text(nombre, chartX - 240, chartY + 5, {
          width: 235,
          align: "right",
        });
        doc.rect(chartX, chartY, chartW, barH).fill("#ecf0f1");
        doc.rect(chartX, chartY, bW, barH).fill("#3498db");
        doc.fontSize(8).fillColor("#ffffff");
        if (bW > 30) {
          doc.text(`${p.total_pcs} PCs`, chartX + bW - 40, chartY + 6, {
            width: 38,
            align: "right",
          });
        } else {
          doc
            .fillColor("#2c3e50")
            .text(`${p.total_pcs} PCs`, chartX + bW + 4, chartY + 6);
        }
        chartY += barH + 10;
      });
    }
    doc.end();
  } catch (err) {
    console.error("[PDF] Error:", err);
    res.status(500).json({ error: "Error generando PDF" });
  }
});

// ============================================
// ENDPOINTS: comandos remotos
// ============================================
app.post("/api/comandos/crear", async (req, res) => {
  try {
    if (!req.session.autenticado)
      return res.status(401).json({ error: "No autenticado" });
    const { pc_id } = req.body;
    if (!pc_id) return res.status(400).json({ error: "pc_id requerido" });
    await db.query(
      'UPDATE comandos SET estado = "cancelado" WHERE pc_id = ? AND estado = "pendiente"',
      [pc_id],
    );
    await db.query(
      'INSERT INTO comandos (pc_id, comando, estado) VALUES (?, "limpiar", "pendiente")',
      [pc_id],
    );
    res.json({ ok: true, mensaje: "Comando creado" });
  } catch (err) {
    console.error("[Comando] Error:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/api/comandos/:serial", async (req, res) => {
  try {
    const token = req.headers["x-agent-token"];
    if (token !== process.env.AGENT_TOKEN)
      return res.status(401).json({ error: "Token invalido" });
    const [pcs] = await db.query("SELECT id FROM pcs WHERE serial = ?", [
      req.params.serial,
    ]);
    if (!pcs.length) return res.json({ hay: false });
    const [cmds] = await db.query(
      'SELECT id, comando FROM comandos WHERE pc_id = ? AND estado = "pendiente" ORDER BY creado ASC LIMIT 1',
      [pcs[0].id],
    );
    if (!cmds.length) return res.json({ hay: false });
    await db.query('UPDATE comandos SET estado = "ejecutando" WHERE id = ?', [
      cmds[0].id,
    ]);
    res.json({ hay: true, id: cmds[0].id, comando: cmds[0].comando });
  } catch (err) {
    console.error("[Poll] Error:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/comandos/resultado", async (req, res) => {
  try {
    const token = req.headers["x-agent-token"];
    if (token !== process.env.AGENT_TOKEN)
      return res.status(401).json({ error: "Token invalido" });
    const { id, estado, mb_liberados, espacio_libre_gb } = req.body;
    if (!id) return res.status(400).json({ error: "id requerido" });
    await db.query(
      "UPDATE comandos SET estado = ?, ejecutado = NOW(), resultado = ? WHERE id = ?",
      [
        estado || "completado",
        mb_liberados != null ? mb_liberados + " MB liberados" : null,
        id,
      ],
    );
    if (mb_liberados != null && espacio_libre_gb != null) {
      await db.query(
        "UPDATE pcs SET mb_liberados_ultima = ?, espacio_libre_gb = ?, ultima_limpieza = NOW(), ultimo_reporte = NOW() WHERE id = (SELECT pc_id FROM comandos WHERE id = ?)",
        [mb_liberados, espacio_libre_gb, id],
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[Resultado] Error:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/api/comandos/estado/:pc_id", async (req, res) => {
  try {
    if (!req.session.autenticado)
      return res.status(401).json({ error: "No autenticado" });
    const [rows] = await db.query(
      "SELECT id, estado, creado, ejecutado, resultado FROM comandos WHERE pc_id = ? ORDER BY creado DESC LIMIT 1",
      [req.params.pc_id],
    );
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: "Error" });
  }
});

// ============================================
// ENDPOINT: exportar historial a Excel
// ============================================
app.get("/api/export/historial-excel", async (req, res) => {
  try {
    const { pc_id, desde, hasta } = req.query;
    let where = [];
    let params = [];
    if (pc_id) {
      where.push("h.pc_id = ?");
      params.push(pc_id);
    }
    if (desde) {
      where.push("h.fecha >= ?");
      params.push(desde);
    }
    if (hasta) {
      where.push("h.fecha <= ?");
      params.push(hasta + " 23:59:59");
    }
    const whereStr = where.length ? "WHERE " + where.join(" AND ") : "";
    const [rows] = await db.query(
      `
      SELECT p.serial, p.modelo, p.usuario,
             h.fecha, h.mb_liberados, h.espacio_libre_gb
      FROM historial_limpiezas h
      JOIN pcs p ON p.id = h.pc_id
      ${whereStr}
      ORDER BY h.fecha DESC
    `,
      params,
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = "Xentra-Agent";
    wb.created = new Date();
    const ws = wb.addWorksheet("Historial Limpiezas");

    ws.columns = [
      { header: "Serial", key: "serial", width: 20 },
      { header: "Modelo", key: "modelo", width: 25 },
      { header: "Usuario", key: "usuario_limpio", width: 30 },
      { header: "Fecha", key: "fecha", width: 22 },
      { header: "GB liberados", key: "mb_liberados", width: 14 },
      { header: "Disco libre (GB)", key: "espacio_libre_gb", width: 16 },
    ];

    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF34495E" },
    };
    ws.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    rows.forEach((r) =>
      ws.addRow({
        serial: r.serial,
        modelo: r.modelo || "-",
        usuario_limpio: limpiarUsuario(r.usuario),
        fecha: r.fecha ? new Date(r.fecha).toLocaleDateString("es-CO") : null,
        mb_liberados:
          r.mb_liberados != null
            ? parseFloat((r.mb_liberados / 1024).toFixed(2))
            : null,
        espacio_libre_gb: r.espacio_libre_gb
          ? Math.round(r.espacio_libre_gb)
          : null,
      }),
    );

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="historial_' +
        (pc_id && rows[0]?.usuario
          ? rows[0].usuario.replace(/.*\\/, "").replace(/[^a-zA-Z0-9]/g, "_") +
            "_"
          : "") +
        fecha +
        '.xlsx"',
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[Historial Excel] Error:", err);
    res.status(500).json({ error: "Error generando Excel" });
  }
});

// ============================================
// ENDPOINT: exportar historial a PDF
// ============================================
app.get("/api/export/historial-pdf", async (req, res) => {
  try {
    const { pc_id, desde, hasta } = req.query;
    let where = [];
    let params = [];
    if (pc_id) {
      where.push("h.pc_id = ?");
      params.push(pc_id);
    }
    if (desde) {
      where.push("h.fecha >= ?");
      params.push(desde);
    }
    if (hasta) {
      where.push("h.fecha <= ?");
      params.push(hasta + " 23:59:59");
    }
    const whereStr = where.length ? "WHERE " + where.join(" AND ") : "";
    const [rows] = await db.query(
      `
      SELECT p.serial, p.modelo, p.usuario,
             h.fecha, h.mb_liberados, h.espacio_libre_gb
      FROM historial_limpiezas h
      JOIN pcs p ON p.id = h.pc_id
      ${whereStr}
      ORDER BY h.fecha DESC
    `,
      params,
    );

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="historial_' +
        (pc_id && rows[0]?.usuario
          ? rows[0].usuario.replace(/.*\\/, "").replace(/[^a-zA-Z0-9]/g, "_") +
            "_"
          : "") +
        fecha +
        '.pdf"',
    );

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 30,
    });
    doc.pipe(res);
    // Logo UNGRD
    const logoPath = __dirname + "/public/assets/logo-ungrd.png";
    const fs2 = require("fs");
    if (fs2.existsSync(logoPath)) {
      doc.image(logoPath, 30, 20, { width: 80 });
    }
    const titleX = 120;

    doc
      .fontSize(18)
      .fillColor("#2c3e50")
      .text("Historial de Limpiezas", titleX, 30, { align: "center" });
    doc
      .fontSize(10)
      .fillColor("#7f8c8d")
      .text(
        `Generado: ${new Date().toLocaleString("es-CO")} | Total: ${rows.length} registros`,
        { align: "center" },
      );
    doc.moveDown(1);

    const headers = [
      "Serial",
      "Modelo",
      "Usuario",
      "Fecha",
      "GB Liberados",
      "Disco Libre",
    ];
    const widths = [110, 130, 140, 150, 100, 90];
    const totalW = widths.reduce((a, b) => a + b, 0);
    const startX = 30;
    const rowH = 18;

    function drawHeader(y) {
      doc.rect(startX, y, totalW, 20).fill("#34495e");
      let x = startX;
      doc.fontSize(9).fillColor("#ffffff");
      headers.forEach((h, i) => {
        doc.text(h, x + 4, y + 6, {
          width: widths[i] - 8,
          align: "left",
          lineBreak: false,
        });
        x += widths[i];
      });
      return y + 20;
    }

    let y = doc.y;
    y = drawHeader(y);
    doc.fontSize(8);
    rows.forEach((r, idx) => {
      if (y > 520) {
        doc.addPage();
        y = 40;
        y = drawHeader(y);
        doc.fontSize(8);
      }
      if (idx % 2 === 0) {
        doc.rect(startX, y, totalW, rowH).fill("#f4f6f8");
      }
      let x = startX;
      const cells = [
        r.serial || "-",
        (r.modelo || "-").substring(0, 18),
        (r.usuario ? r.usuario.replace(/^[^\\]+\\/, "") : "-").substring(0, 18),
        r.fecha
          ? new Date(r.fecha).toLocaleString("es-CO", {
              dateStyle: "short",
              timeStyle: "short",
            })
          : "-",
        r.mb_liberados != null
          ? (r.mb_liberados / 1024).toFixed(2) + " GB"
          : "-",
        r.espacio_libre_gb
          ? parseFloat(r.espacio_libre_gb).toFixed(0) + " GB"
          : "-",
      ];
      cells.forEach((c, i) => {
        doc.fillColor("#2c3e50");
        doc.text(c, x + 4, y + 5, {
          width: widths[i] - 8,
          align: "left",
          lineBreak: false,
          ellipsis: true,
        });
        x += widths[i];
      });
      y += rowH;
    });

    doc.end();
  } catch (err) {
    console.error("[Historial PDF] Error:", err);
    res.status(500).json({ error: "Error generando PDF" });
  }
});

// ============================================
// ============================================
// ENDPOINT: exportar programas PDF
// ============================================
app.get("/api/export/programas-pdf", async (req, res) => {
  try {
    if (!req.session.autenticado)
      return res.status(401).json({ error: "No autenticado" });
    const [rows] = await db.query(`
      SELECT p.serial, p.modelo, p.usuario, pr.nombre, pr.version, pr.fabricante
      FROM programas pr
      JOIN pcs p ON p.id = pr.pc_id
      ORDER BY p.serial ASC, pr.nombre ASC
    `);
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="programas_' + fecha + '.pdf"',
    );
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 30,
    });
    doc.pipe(res);
    // Logo UNGRD
    const logoPath = __dirname + "/public/assets/logo-ungrd.png";
    try {
      doc.image(logoPath, 750, 5, { width: 80, height: 50 });
    } catch (e) {}

    doc
      .fontSize(18)
      .fillColor("#2c3e50")
      .text("Inventario de Programas", { align: "center" });
    doc
      .fontSize(10)
      .fillColor("#7f8c8d")
      .text(
        `Generado: ${new Date().toLocaleString("es-CO")} | Total: ${rows.length} registros`,
        { align: "center" },
      );
    doc.moveDown(1);

    const headers = [
      "Serial",
      "Modelo",
      "Usuario",
      "Programa",
      "Version",
      "Fabricante",
    ];
    const widths = [85, 120, 100, 200, 80, 120];
    const totalW = widths.reduce((a, b) => a + b, 0);
    const startX = 30;
    const rowH = 16;

    function drawHeader(y) {
      doc.rect(startX, y, totalW, 20).fill("#1a3a6b");
      let x = startX;
      doc.fontSize(9).fillColor("#ffffff");
      headers.forEach((h, i) => {
        doc.text(h, x + 4, y + 6, {
          width: widths[i] - 8,
          align: "left",
          lineBreak: false,
        });
        x += widths[i];
      });
      return y + 20;
    }

    let y = doc.y;
    y = drawHeader(y);
    doc.fontSize(8);

    rows.forEach((r, idx) => {
      if (y > 520) {
        doc.addPage();
        try {
          doc.image(logoPath, 750, 5, { width: 80, height: 50 });
        } catch (e) {}
        doc
          .fontSize(18)
          .fillColor("#2c3e50")
          .text("Inventario de Programas", { align: "center" });
        doc
          .fontSize(10)
          .fillColor("#7f8c8d")
          .text(
            `Generado: ${new Date().toLocaleString("es-CO")} | Total: ${rows.length} registros`,
            { align: "center" },
          );
        doc.moveDown(0.5);
        y = doc.y;
        y = drawHeader(y);
        doc.fontSize(8);
      }
      if (idx % 2 === 0) {
        doc.rect(startX, y, totalW, rowH).fill("#f4f6f8");
      }
      let x = startX;
      const usuario = r.usuario ? r.usuario.split("\\").pop() : "-";
      const cells = [
        r.serial || "-",
        (r.modelo || "-").substring(0, 20),
        usuario.substring(0, 18),
        (r.nombre || "-").substring(0, 38),
        (r.version || "-").substring(0, 14),
        (r.fabricante || "-").substring(0, 22),
      ];
      cells.forEach((c, i) => {
        doc.fillColor("#2c3e50");
        doc.text(c, x + 4, y + 4, {
          width: widths[i] - 8,
          align: "left",
          lineBreak: false,
          ellipsis: true,
        });
        x += widths[i];
      });
      y += rowH;
    });

    doc.end();
  } catch (err) {
    console.error("[Programas PDF] Error:", err);
    res.status(500).json({ error: "Error generando PDF" });
  }
});

// ENDPOINT: eliminar PC (desde uninstall o panel)
// ============================================
app.delete("/api/pcs/:serial", async (req, res) => {
  try {
    const token = req.headers["x-agent-token"];
    const sesion = req.session?.autenticado;
    if (token !== process.env.AGENT_TOKEN && !sesion) {
      return res.status(401).json({ error: "No autorizado" });
    }
    const [result] = await db.query("DELETE FROM pcs WHERE serial = ?", [
      req.params.serial,
    ]);
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "PC no encontrado" });
    res.json({ ok: true, mensaje: "PC eliminado" });
  } catch (err) {
    console.error("[Delete PC] Error:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

// ============================================
// ENDPOINT: obtener/cambiar estado USB de un PC
// ============================================
app.post("/api/pcs/:serial/usb", async (req, res) => {
  try {
    if (!req.session.autenticado)
      return res.status(401).json({ error: "No autenticado" });
    const { bloqueado } = req.body;
    if (bloqueado === undefined)
      return res.status(400).json({ error: "bloqueado requerido" });
    const [result] = await db.query(
      "UPDATE pcs SET usb_bloqueado = ? WHERE serial = ?",
      [bloqueado ? 1 : 0, req.params.serial],
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "PC no encontrado" });
    res.json({ ok: true, usb_bloqueado: bloqueado ? 1 : 0 });
  } catch (err) {
    console.error("[USB] Error:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

// ENDPOINT: PC consulta estado USB (desde el agente)
app.get("/api/pcs/:serial/usb", async (req, res) => {
  try {
    const token = req.headers["x-agent-token"];
    if (token !== process.env.AGENT_TOKEN)
      return res.status(401).json({ error: "Token invalido" });
    const [rows] = await db.query(
      "SELECT usb_bloqueado FROM pcs WHERE serial = ?",
      [req.params.serial],
    );
    if (!rows.length) return res.json({ usb_bloqueado: 1 });
    res.json({ usb_bloqueado: rows[0].usb_bloqueado });
  } catch (err) {
    res.status(500).json({ error: "Error" });
  }
});

// ENDPOINT: estado USB para el panel (tiempo real)
app.get("/api/pcs/:serial/usb-estado", async (req, res) => {
  try {
    if (!req.session.autenticado)
      return res.status(401).json({ error: "No autenticado" });
    const [rows] = await db.query(
      "SELECT usb_bloqueado FROM pcs WHERE serial = ?",
      [req.params.serial],
    );
    if (!rows.length)
      return res.status(404).json({ error: "PC no encontrado" });
    res.json({ usb_bloqueado: rows[0].usb_bloqueado });
  } catch (err) {
    res.status(500).json({ error: "Error" });
  }
});

// ============================================

// ENDPOINT: stats de programas
app.get("/api/stats/programas", async (req, res) => {
  if (!req.session.autenticado)
    return res.status(401).json({ error: "No autenticado" });
  try {
    const [[totales]] = await db.query(`
      SELECT COUNT(*) AS total_registros,
             COUNT(DISTINCT nombre) AS total_unicos,
             COUNT(DISTINCT pc_id) AS total_pcs
      FROM programas
    `);
    const [top10] = await db.query(`
      SELECT nombre, COUNT(DISTINCT pc_id) AS total_pcs
      FROM programas
      GROUP BY nombre
      ORDER BY total_pcs DESC
      LIMIT 10
    `);
    res.json({ totales, top10 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ENDPOINT: recibir programas instalados
// ============================================
app.post("/api/programas", async (req, res) => {
  try {
    const token = req.headers["x-agent-token"];
    if (token !== process.env.AGENT_TOKEN)
      return res.status(401).json({ error: "Token invalido" });
    const { serial, programas } = req.body;
    if (!serial || !programas)
      return res.status(400).json({ error: "Datos requeridos" });
    const [pc] = await db.query("SELECT id FROM pcs WHERE serial = ?", [
      serial,
    ]);
    if (!pc.length) return res.status(404).json({ error: "PC no encontrado" });
    const pc_id = pc[0].id;
    await db.query("DELETE FROM programas WHERE pc_id = ?", [pc_id]);
    if (programas.length > 0) {
      const values = programas.map((p) => [
        pc_id,
        p.nombre,
        p.version || null,
        p.fabricante || null,
      ]);
      await db.query(
        "INSERT INTO programas (pc_id, nombre, version, fabricante) VALUES ?",
        [values],
      );
    }
    res.json({ ok: true, total: programas.length });
  } catch (err) {
    console.error("[Programas] Error:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

// ENDPOINT: obtener programas de un PC
app.get("/api/programas/:serial", async (req, res) => {
  try {
    if (!req.session.autenticado)
      return res.status(401).json({ error: "No autenticado" });
    const [rows] = await db.query(
      `
      SELECT p.nombre, p.version, p.fabricante
      FROM programas p
      JOIN pcs ON pcs.id = p.pc_id
      WHERE pcs.serial = ?
      ORDER BY p.nombre ASC
    `,
      [req.params.serial],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error" });
  }
});

// ============================================
// ENDPOINT: exportar inventario programas Excel
// ============================================
app.get("/api/export/programas-excel", async (req, res) => {
  try {
    if (!req.session.autenticado)
      return res.status(401).json({ error: "No autenticado" });
    const [rows] = await db.query(`
      SELECT p.serial, p.modelo, p.usuario, pr.nombre, pr.version, pr.fabricante
      FROM programas pr
      JOIN pcs p ON p.id = pr.pc_id
      ORDER BY p.serial ASC, pr.nombre ASC
    `);

    const wb = new ExcelJS.Workbook();
    wb.creator = "Xentra-Agent";
    wb.created = new Date();
    const ws = wb.addWorksheet("Inventario Programas");

    ws.columns = [
      { header: "Serial", key: "serial", width: 18 },
      { header: "Modelo", key: "modelo", width: 28 },
      { header: "Usuario", key: "usuario", width: 22 },
      { header: "Programa", key: "nombre", width: 42 },
      { header: "Version", key: "version", width: 18 },
      { header: "Fabricante", key: "fabricante", width: 30 },
    ];
    ws.getRow(1).font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
      name: "Arial",
      size: 10,
    };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1a3a6b" },
    };
    ws.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
    ws.getRow(1).height = 22;
    ws.autoFilter = { from: "A1", to: "F1" };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    rows.forEach((r, idx) => {
      const usuario = r.usuario ? r.usuario.split("\\").pop() : "-";
      const row = ws.addRow({
        serial: r.serial,
        modelo: r.modelo || "-",
        usuario: usuario,
        nombre: r.nombre,
        version: r.version || "-",
        fabricante: r.fabricante || "-",
      });
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: idx % 2 === 0 ? "FFEEF2F7" : "FFFFFFFF" },
      };
      row.font = { name: "Arial", size: 9 };
      row.height = 15;
    });

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="programas_${fecha}.xlsx"`,
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[Programas Excel] Error:", err);
    res.status(500).json({ error: "Error generando Excel" });
  }
});

app.get("/api/stats/areas", async (req, res) => {
  try {
    const sql = `
      SELECT
        CASE
          WHEN usuario LIKE '%Recepcion%' OR usuario LIKE '%alas' THEN 'Admin'
          WHEN usuario LIKE '%Asesor%' THEN 'SecGeneral'
          WHEN usuario LIKE '%Infopu%' THEN 'Comunicaciones'
          WHEN usuario LIKE '%ProyectosE%' THEN 'Reduccion'
          WHEN usuario REGEXP '_[A-Za-z]+$' THEN SUBSTRING_INDEX(usuario, '_', -1)
          ELSE 'Otros'
        END as area,
        COUNT(*) as total
      FROM pcs
      WHERE activo = 1
      GROUP BY area
      ORDER BY total DESC
    `;
    const [rows] = await db.query(sql);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/health", (req, res) =>
  res.json({ ok: true, service: "xentra-agent" }),
);

app.listen(PORT, () => {
  console.log(`[xentra-agent] Escuchando en puerto ${PORT}`);
});
