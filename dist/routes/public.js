"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const apiAuth_1 = require("../middleware/apiAuth");
const router = (0, express_1.Router)();
router.get('/api/public/pcs', apiAuth_1.apiAuth, async (req, res) => {
    try {
        const empresaId = req.apiEmpresaId;
        const [rows] = await db_1.default.query(`
      SELECT serial, nombre_equipo, modelo, usuario, ip_local,
        disco_libre_gb, disco_total_gb, ram_gb, procesador,
        version_windows, antivirus, garantia_status, garantia_fin,
        ultimo_reporte, version_agente,
        CASE
          WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 'inactivo'
          WHEN (disco_libre_gb / disco_total_gb) < 0.20 THEN 'alerta'
          ELSE 'activo'
        END AS estado
      FROM pcs
      WHERE empresa_id=? AND activo=1 AND deleted_at IS NULL
      ORDER BY nombre_equipo ASC
    `, [empresaId]);
        res.json({ total: rows.length, pcs: rows });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/api/public/stats', apiAuth_1.apiAuth, async (req, res) => {
    try {
        const empresaId = req.apiEmpresaId;
        const [rows] = await db_1.default.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) as activos,
        SUM(CASE WHEN ultimo_reporte < DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) as inactivos,
        SUM(CASE WHEN (disco_libre_gb / disco_total_gb) < 0.20 THEN 1 ELSE 0 END) as alertas_disco,
        SUM(CASE WHEN garantia_status='vencida' THEN 1 ELSE 0 END) as garantias_vencidas
      FROM pcs WHERE empresa_id=? AND activo=1 AND deleted_at IS NULL
    `, [empresaId]);
        res.json(rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
