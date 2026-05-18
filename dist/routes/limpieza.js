"use strict";
const express = require("express");
const pool = require("../db");
const router = express.Router();
router.post('/api/limpiar-masivo', async (req, res) => {
    try {
        const [pcsActivos] = await pool.query("SELECT id FROM pcs WHERE activo=1 AND ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
        if (!pcsActivos.length)
            return res.status(400).json({ error: 'No hay PCs activos' });
        const [camp] = await pool.query("INSERT INTO campanas_limpieza (total_pcs) VALUES (?)", [pcsActivos.length]);
        const campanaId = camp.insertId;
        const valores = pcsActivos.map((p) => [campanaId, p.id]);
        await pool.query("INSERT INTO comandos_limpieza (campana_id, pc_id) VALUES ?", [valores]);
        res.json({ ok: true, campana_id: campanaId, total: pcsActivos.length });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.get('/api/limpieza/campanas', async (req, res) => {
    try {
        const [rows] = await pool.query(`
      SELECT c.*,
        SUM(CASE WHEN cl.estado='ejecutado' THEN 1 ELSE 0 END) AS ejecutados,
        SUM(CASE WHEN cl.estado='pendiente' AND cl.fecha_expiracion > NOW() THEN 1 ELSE 0 END) AS pendientes,
        SUM(CASE WHEN cl.estado='expirado' OR (cl.estado='pendiente' AND cl.fecha_expiracion <= NOW()) THEN 1 ELSE 0 END) AS expirados
      FROM campanas_limpieza c LEFT JOIN comandos_limpieza cl ON cl.campana_id=c.id
      GROUP BY c.id ORDER BY c.fecha_creacion DESC LIMIT 10
    `);
        res.json(rows);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.get('/api/limpieza/detalle/:id', async (req, res) => {
    try {
        await pool.query("UPDATE comandos_limpieza SET estado='expirado' WHERE estado='pendiente' AND fecha_expiracion <= NOW()");
        const [rows] = await pool.query(`
      SELECT cl.*, p.nombre_equipo, p.serial, p.modelo, p.ultimo_reporte
      FROM comandos_limpieza cl JOIN pcs p ON p.id=cl.pc_id
      WHERE cl.campana_id=? ORDER BY cl.estado ASC, cl.fecha_ejecucion DESC
    `, [req.params.id]);
        res.json(rows);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
module.exports = router;
