"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const pool = require("../db");
const agentAuth_1 = require("../middleware/agentAuth");
const router = express.Router();
// POST /api/update/inicio — PC notifica que va a actualizar
router.post('/api/update/inicio', agentAuth_1.agentAuth, async (req, res) => {
    try {
        const { serial, version_anterior, version_nueva, sha256_esperado } = req.body;
        const empresa_id = req.apiEmpresaId;
        if (!serial)
            return res.status(400).json({ error: 'Faltan campos' });
        await pool.query(`INSERT INTO pcs_updates (serial, empresa_id, version_anterior, version_nueva, sha256_esperado, status, fecha_inicio)
       VALUES (?, ?, ?, ?, ?, 'iniciando', NOW())`, [serial, empresa_id, version_anterior, version_nueva, sha256_esperado]);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// POST /api/update/resultado — PC notifica resultado del update
router.post('/api/update/resultado', agentAuth_1.agentAuth, async (req, res) => {
    try {
        const { serial, version_nueva, status, motivo } = req.body;
        const empresa_id = req.apiEmpresaId;
        if (!serial || !status)
            return res.status(400).json({ error: 'Faltan campos' });
        await pool.query(`UPDATE pcs_updates SET status=?, motivo=?, fecha_fin=NOW()
       WHERE serial=? AND empresa_id=? AND version_nueva=?
       ORDER BY fecha_inicio DESC LIMIT 1`, [status, motivo || null, serial, empresa_id, version_nueva]);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
exports.default = router;
