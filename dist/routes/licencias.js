"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const logger_1 = require("../modules/logger");
const router = (0, express_1.Router)();
// GET /api/licencias — listar licencias de la empresa
router.get('/api/licencias', async (req, res) => {
    try {
        const empresaId = req.session?.usuario?.empresa_id;
        if (!empresaId)
            return res.status(401).json({ error: 'No autenticado' });
        const [rows] = await db_1.default.query(`
      SELECT l.*,
        COUNT(DISTINCT p.pc_id) AS instalaciones
      FROM xentra_licencias l
      LEFT JOIN pcs_programas p ON p.nombre LIKE CONCAT('%', l.nombre, '%')
        AND p.pc_id IN (SELECT id FROM pcs WHERE empresa_id = ? AND activo = 1)
      WHERE l.empresa_id = ? AND l.activo = 1
      GROUP BY l.id
      ORDER BY l.nombre ASC
    `, [empresaId, empresaId]);
        res.json(rows);
    }
    catch (err) {
        (0, logger_1.logError)('GET_LICENCIAS', err.message);
        res.status(500).json({ error: 'Error consultando licencias' });
    }
});
// POST /api/licencias — crear licencia
router.post('/api/licencias', async (req, res) => {
    try {
        const empresaId = req.session?.usuario?.empresa_id;
        if (!empresaId)
            return res.status(401).json({ error: 'No autenticado' });
        const { nombre, fabricante, total, vencimiento, proveedor, notas } = req.body;
        if (!nombre || !total)
            return res.status(400).json({ error: 'nombre y total requeridos' });
        const [result] = await db_1.default.query(`
      INSERT INTO xentra_licencias (empresa_id, nombre, fabricante, total, vencimiento, proveedor, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [empresaId, nombre, fabricante || null, total, vencimiento || null, proveedor || null, notas || null]);
        (0, logger_1.logInfo)('LICENCIA_CREADA');
        res.json({ ok: true, id: result.insertId });
    }
    catch (err) {
        (0, logger_1.logError)('POST_LICENCIAS', err.message);
        res.status(500).json({ error: 'Error creando licencia' });
    }
});
// PUT /api/licencias/:id — editar licencia
router.put('/api/licencias/:id', async (req, res) => {
    try {
        const empresaId = req.session?.usuario?.empresa_id;
        if (!empresaId)
            return res.status(401).json({ error: 'No autenticado' });
        const { nombre, fabricante, total, vencimiento, proveedor, notas } = req.body;
        await db_1.default.query(`
      UPDATE xentra_licencias SET nombre=?, fabricante=?, total=?, vencimiento=?, proveedor=?, notas=?
      WHERE id=? AND empresa_id=?
    `, [nombre, fabricante || null, total, vencimiento || null, proveedor || null, notas || null, req.params.id, empresaId]);
        (0, logger_1.logInfo)('LICENCIA_EDITADA');
        res.json({ ok: true });
    }
    catch (err) {
        (0, logger_1.logError)('PUT_LICENCIAS', err.message);
        res.status(500).json({ error: 'Error editando licencia' });
    }
});
// DELETE /api/licencias/:id — soft delete
router.delete('/api/licencias/:id', async (req, res) => {
    try {
        const empresaId = req.session?.usuario?.empresa_id;
        if (!empresaId)
            return res.status(401).json({ error: 'No autenticado' });
        await db_1.default.query(`
      UPDATE xentra_licencias SET activo=0 WHERE id=? AND empresa_id=?
    `, [req.params.id, empresaId]);
        (0, logger_1.logInfo)('LICENCIA_ELIMINADA');
        res.json({ ok: true });
    }
    catch (err) {
        (0, logger_1.logError)('DELETE_LICENCIAS', err.message);
        res.status(500).json({ error: 'Error eliminando licencia' });
    }
});
// GET /api/licencias/alertas — vencidas o por vencer en 30 días
router.get('/api/licencias/alertas', async (req, res) => {
    try {
        const empresaId = req.session?.usuario?.empresa_id;
        if (!empresaId)
            return res.status(401).json({ error: 'No autenticado' });
        const [rows] = await db_1.default.query(`
      SELECT *, DATEDIFF(vencimiento, NOW()) AS dias_restantes
      FROM xentra_licencias
      WHERE empresa_id = ? AND activo = 1
        AND vencimiento IS NOT NULL
        AND vencimiento <= DATE_ADD(NOW(), INTERVAL 30 DAY)
      ORDER BY vencimiento ASC
    `, [empresaId]);
        res.json(rows);
    }
    catch (err) {
        (0, logger_1.logError)('GET_LICENCIAS_ALERTAS', err.message);
        res.status(500).json({ error: 'Error consultando alertas' });
    }
});
exports.default = router;
