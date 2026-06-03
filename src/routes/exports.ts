import express = require("express");
import { Request, Response } from "express";
import pool = require("../db");
import { RowDataPacket } from "mysql2/promise";
import ExcelJS = require("exceljs");
import PDFDocument = require("pdfkit");
import path = require("path");

const router = express.Router();

function limpiarUsuario(usuario: string | null) {
  if (!usuario) return "-";
  return usuario.includes("\\") ? usuario.split("\\").pop() || "-" : usuario;
}

router.get("/api/export/excel", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT nombre_equipo, serial, modelo, usuario, ip_local,
        disco_libre_gb, disco_total_gb, mb_liberados_ultima, ultima_limpieza,
        ram_gb, procesador, version_windows, ultimo_reporte,
        CASE WHEN ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 'Activo'
          WHEN ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'Alerta'
          ELSE 'Inactivo' END AS estado
      FROM pcs WHERE activo=1 ORDER BY ultimo_reporte DESC
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
      { header: "Disco libre (GB)", key: "disco_libre_gb", width: 16 },
      { header: "Disco total (GB)", key: "disco_total_gb", width: 16 },
      { header: "GB liberados", key: "mb_liberados_ultima", width: 14 },
      { header: "Ultima limpieza", key: "ultima_limpieza", width: 20 },
      { header: "Procesador", key: "procesador", width: 35 },
      { header: "RAM (GB)", key: "ram_gb", width: 12 },
      { header: "Windows", key: "version_windows", width: 14 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF34495E" },
    };
    ws.getRow(1).alignment = { vertical: "middle", horizontal: "left" };
    (rows as any[]).forEach((r) =>
      ws.addRow({
        estado: r.estado,
        serial: r.serial,
        modelo: r.modelo || "-",
        usuario_limpio: limpiarUsuario(r.usuario),
        ip_local: r.ip_local,
        disco_libre_gb: r.disco_libre_gb
          ? Math.round(r.disco_libre_gb)
          : null,
        disco_total_gb: r.disco_total_gb
          ? Math.round(r.disco_total_gb)
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
    ws.views = [{ state: "frozen", ySplit: 1 }];
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="reporte_' + fecha + '.xlsx"',
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get(
  "/api/export/historial-excel",
  async (req: Request, res: Response) => {
    try {
      const { pc_id, desde, hasta } = req.query as any;
      const where: string[] = [];
      const params: any[] = [];
      if (pc_id) {
        where.push("h.pc_id=?");
        params.push(pc_id);
      }
      if (desde) {
        where.push("h.fecha>=?");
        params.push(desde);
      }
      if (hasta) {
        where.push("h.fecha<=?");
        params.push(hasta + " 23:59:59");
      }
      const whereStr = where.length ? "WHERE " + where.join(" AND ") : "";
      const [rows] = await pool.query<RowDataPacket[]>(
        `
      SELECT p.serial, p.modelo, p.usuario, h.fecha, h.mb_liberados, h.disco_libre_gb
      FROM pcs_historial_limpiezas h JOIN pcs p ON p.id=h.pc_id ${whereStr} ORDER BY h.fecha DESC
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
        { header: "Disco libre (GB)", key: "disco_libre_gb", width: 16 },
      ];
      ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF34495E" },
      };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      (rows as any[]).forEach((r) =>
        ws.addRow({
          serial: r.serial,
          modelo: r.modelo || "-",
          usuario_limpio: limpiarUsuario(r.usuario),
          fecha: r.fecha ? new Date(r.fecha).toLocaleDateString("es-CO") : null,
          mb_liberados:
            r.mb_liberados != null
              ? parseFloat((r.mb_liberados / 1024).toFixed(2))
              : null,
          disco_libre_gb: r.disco_libre_gb
            ? Math.round(r.disco_libre_gb)
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
        'attachment; filename="historial_' + fecha + '.xlsx"',
      );
      await wb.xlsx.write(res);
      res.end();
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },
);

router.get(
  "/api/export/programas-excel",
  async (req: Request, res: Response) => {
    try {
      if (!(req.session as any).autenticado)
        return res.status(401).json({ error: "No autenticado" });
      const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT p.serial, p.modelo, p.usuario, pr.nombre, pr.version, pr.fabricante
      FROM pcs_programas pr JOIN pcs p ON p.id=pr.pc_id ORDER BY p.serial ASC, pr.nombre ASC
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
      ws.autoFilter = { from: "A1", to: "F1" };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      (rows as any[]).forEach((r, idx) => {
        const usuario = r.usuario ? r.usuario.split("\\").pop() : "-";
        const row = ws.addRow({
          serial: r.serial,
          modelo: r.modelo || "-",
          usuario,
          nombre: r.nombre,
          version: r.version || "-",
          fabricante: r.fabricante || "-",
        });
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: idx % 2 === 0 ? "FFEEF2F7" : "FFFFFFFF" },
        };
      });
      const fecha = new Date().toISOString().slice(0, 10);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="programas_' + fecha + '.xlsx"',
      );
      await wb.xlsx.write(res);
      res.end();
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },
);

router.get("/api/export/pdf", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT nombre_equipo, serial, modelo, usuario, ip_local, disco_libre_gb, disco_total_gb,
        mb_liberados_ultima, ultima_limpieza, ram_gb, procesador, version_windows,
        CASE WHEN ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 'Activo'
          WHEN ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'Alerta'
          ELSE 'Inactivo' END AS estado
      FROM pcs WHERE activo=1 ORDER BY ultimo_reporte DESC
    `);
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="reporte_' + fecha + '.pdf"',
    );
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 30,
    });
    doc.pipe(res);
    const logoPath = path.join(__dirname, "../../public/assets/logo-ungrd.png");
    try {
      doc.image(logoPath, 760, 5, { width: 65, height: 65 });
    } catch (e) {}
    doc.fontSize(18).fillColor("#2c3e50").text("Reporte", { align: "center" });
    doc
      .fontSize(10)
      .fillColor("#7f8c8d")
      .text(
        "Generado: " +
          new Date().toLocaleString("es-CO") +
          " | Total: " +
          (rows as any[]).length +
          " PCs",
        { align: "center" },
      );
    doc.moveDown(1);
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
      "Ult. limpieza",
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
    doc.fontSize(8);
    (rows as any[]).forEach((r, idx) => {
      if (y > 520) {
        doc.addPage();
        y = 40;
      }
      if (idx % 2 === 0)
        doc
          .rect(
            30,
            y,
            widths.reduce((a, b) => a + b, 0),
            18,
          )
          .fill("#f9fafb");
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
          text: r.disco_libre_gb
            ? Math.round(r.disco_libre_gb) + " GB"
            : "-",
        },
        {
          text: r.mb_liberados_ultima
            ? (r.mb_liberados_ultima / 1024).toFixed(1) + " GB"
            : "-",
        },
        {
          text: r.ultima_limpieza
            ? new Date(r.ultima_limpieza).toLocaleDateString("es-CO")
            : "-",
        },
      ];
      cells.forEach((c, i) => {
        doc.fillColor((c as any).color || "#2c3e50");
        doc.text(c.text, x, y + 7, {
          width: widths[i],
          align: "center",
          ellipsis: true,
        });
        x += widths[i];
      });
      y += 22;
    });
    doc.end();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/export/historial-pdf", async (req: Request, res: Response) => {
  try {
    const { pc_id, desde, hasta } = req.query as any;
    const where: string[] = [];
    const params: any[] = [];
    if (pc_id) {
      where.push("h.pc_id=?");
      params.push(pc_id);
    }
    if (desde) {
      where.push("h.fecha>=?");
      params.push(desde);
    }
    if (hasta) {
      where.push("h.fecha<=?");
      params.push(hasta + " 23:59:59");
    }
    const whereStr = where.length ? "WHERE " + where.join(" AND ") : "";
    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT p.serial, p.modelo, p.usuario, h.fecha, h.mb_liberados, h.disco_libre_gb
      FROM pcs_historial_limpiezas h JOIN pcs p ON p.id=h.pc_id ${whereStr} ORDER BY h.fecha DESC
    `,
      params,
    );
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="historial_' + fecha + '.pdf"',
    );
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 30,
    });
    doc.pipe(res);
    const logoPath = path.join(__dirname, "../../public/assets/logo-ungrd.png");
    try {
      doc.image(logoPath, 30, 20, { width: 80 });
    } catch (e) {}
    doc
      .fontSize(18)
      .fillColor("#2c3e50")
      .text("Historial de Limpiezas", 120, 30, { align: "center" });
    doc
      .fontSize(10)
      .fillColor("#7f8c8d")
      .text(
        "Generado: " +
          new Date().toLocaleString("es-CO") +
          " | Total: " +
          (rows as any[]).length +
          " registros",
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
    function drawHeader(y: number) {
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
    (rows as any[]).forEach((r, idx) => {
      if (y > 520) {
        doc.addPage();
        y = 40;
        y = drawHeader(y);
        doc.fontSize(8);
      }
      if (idx % 2 === 0) doc.rect(startX, y, totalW, rowH).fill("#f4f6f8");
      let x = startX;
      const cells = [
        r.serial || "-",
        (r.modelo || "-").substring(0, 18),
        (r.usuario ? r.usuario.replace(/^[^\\]+\\/, "") : "-").substring(0, 18),
        r.fecha ? new Date(r.fecha).toLocaleDateString("es-CO") : "-",
        r.mb_liberados != null
          ? (r.mb_liberados / 1024).toFixed(2) + " GB"
          : "-",
        r.disco_libre_gb
          ? parseFloat(r.disco_libre_gb).toFixed(0) + " GB"
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
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/export/programas-pdf", async (req: Request, res: Response) => {
  try {
    if (!(req.session as any).autenticado)
      return res.status(401).json({ error: "No autenticado" });
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT p.serial, p.modelo, p.usuario, pr.nombre, pr.version, pr.fabricante
      FROM pcs_programas pr JOIN pcs p ON p.id=pr.pc_id ORDER BY p.serial ASC, pr.nombre ASC
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
    const logoPath = path.join(__dirname, "../../public/assets/logo-ungrd.png");
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
        "Generado: " +
          new Date().toLocaleString("es-CO") +
          " | Total: " +
          (rows as any[]).length +
          " registros",
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
    function drawHeader(y: number) {
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
    (rows as any[]).forEach((r, idx) => {
      if (y > 520) {
        doc.addPage();
        y = 40;
        y = drawHeader(y);
        doc.fontSize(8);
      }
      if (idx % 2 === 0) doc.rect(startX, y, totalW, rowH).fill("#f4f6f8");
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
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export = router;
