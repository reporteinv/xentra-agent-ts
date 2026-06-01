"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const logger_1 = require("../modules/logger");
const router = (0, express_1.Router)();
// GET /api/stats/programas-raros
router.get('/api/stats/programas-raros', async (req, res) => {
    try {
        const [programas] = await db_1.default.query(`
      SELECT
        pp.nombre,
        pp.fabricante,
        COUNT(DISTINCT pp.pc_id) AS total_pcs,
        GROUP_CONCAT(DISTINCT
          CASE
            WHEN p.usuario LIKE '%Recepcion%' OR p.usuario LIKE '%alas' THEN 'Admin'
            WHEN p.usuario LIKE '%Asesor%' THEN 'SecGeneral'
            WHEN p.usuario LIKE '%Infopu%' THEN 'Comunicaciones'
            WHEN p.usuario LIKE '%ProyectosE%' THEN 'Reduccion'
            WHEN p.usuario REGEXP '_[A-Za-z]+$' THEN SUBSTRING_INDEX(p.usuario, '_', -1)
            ELSE 'Otros'
          END
        SEPARATOR ' / ') AS areas,
        CONCAT(
          SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT SUBSTRING_INDEX(COALESCE(p.usuario,''), '\\\\', -1) ORDER BY p.usuario SEPARATOR ' / '), ' / ', 3),
          CASE WHEN COUNT(DISTINCT pp.pc_id) > 3 THEN CONCAT(' ... +', COUNT(DISTINCT pp.pc_id)-3, ' más') ELSE '' END
        ) AS usuarios,
        COALESCE(pe.estado, 'sospechoso') AS estado,
        CASE WHEN pe.id IS NOT NULL THEN 1 ELSE 0 END AS manual
      FROM pcs_programas pp
      JOIN pcs p ON p.id = pp.pc_id
      LEFT JOIN programas_estado pe ON pe.nombre = pp.nombre
      WHERE p.activo = 1 AND p.deleted_at IS NULL
      GROUP BY pp.nombre, pp.fabricante, pe.estado
    `);
        const kpis = {
            sospechosos: programas.filter((p) => p.estado === 'sospechoso').length,
            permitidos: programas.filter((p) => p.estado === 'permitido').length,
            bloqueados: programas.filter((p) => p.estado === 'bloqueado').length,
        };
        res.json({ kpis, programas });
    }
    catch (err) {
        (0, logger_1.logError)('GET_PROGRAMAS_RAROS', err.message);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/programas-raros/estado
router.post('/api/programas-raros/estado', async (req, res) => {
    try {
        const { nombre, fabricante, estado, actualizado_por } = req.body;
        if (!nombre || !['sospechoso', 'permitido', 'bloqueado'].includes(estado))
            return res.status(400).json({ error: 'Datos invalidos' });
        const [matches] = await db_1.default.query('SELECT DISTINCT nombre, fabricante FROM pcs_programas WHERE nombre = ? OR nombre LIKE ?', [nombre, nombre + '%']);
        if (matches.length > 0) {
            for (const m of matches) {
                await db_1.default.query(`
          INSERT INTO programas_estado (nombre, fabricante, estado, actualizado_por)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE estado=VALUES(estado), actualizado_por=VALUES(actualizado_por)
        `, [m.nombre, m.fabricante || null, estado, actualizado_por || 'GTI']);
            }
        }
        else {
            await db_1.default.query(`
        INSERT INTO programas_estado (nombre, fabricante, estado, actualizado_por)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE estado=VALUES(estado), actualizado_por=VALUES(actualizado_por)
      `, [nombre, fabricante || null, estado, actualizado_por || 'GTI']);
        }
        res.json({ ok: true });
    }
    catch (err) {
        (0, logger_1.logError)('POST_PROGRAMAS_ESTADO', err.message);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
