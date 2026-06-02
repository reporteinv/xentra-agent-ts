"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = __importDefault(require("../db"));
const crypto_1 = __importDefault(require("crypto"));
const router = express_1.default.Router();
function authCheck(req, res, next) {
    if (!req.session?.autenticado)
        return res.status(401).json({ error: 'No autenticado' });
    next();
}
// GET — listar tokens de la empresa
router.get('/api/tokens', authCheck, async (req, res) => {
    try {
        const empresaId = req.session.empresa_id || 26;
        const [rows] = await db_1.default.query(`SELECT id, token, descripcion, ultimo_uso, expira_en, activo, created_at
       FROM api_tokens WHERE empresa_id=? ORDER BY created_at DESC`, [empresaId]);
        res.json(rows);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST — generar nuevo token
router.post('/api/tokens', authCheck, async (req, res) => {
    try {
        const empresaId = req.session.empresa_id || 26;
        const { descripcion, expira_en } = req.body;
        const token = 'xnt_' + crypto_1.default.randomBytes(24).toString('hex');
        await db_1.default.query(`INSERT INTO api_tokens (empresa_id, token, descripcion, expira_en) VALUES (?,?,?,?)`, [empresaId, token, descripcion || 'Token API', expira_en || null]);
        res.json({ ok: true, token });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// DELETE — revocar token
router.delete('/api/tokens/:id', authCheck, async (req, res) => {
    try {
        const empresaId = req.session.empresa_id || 26;
        await db_1.default.query(`UPDATE api_tokens SET activo=0 WHERE id=? AND empresa_id=?`, [req.params.id, empresaId]);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// DELETE permanente
router.delete('/api/tokens/:id/eliminar', authCheck, async (req, res) => {
    try {
        const empresaId = req.session.empresa_id || 26;
        await db_1.default.query('DELETE FROM api_tokens WHERE id=? AND empresa_id=?', [req.params.id, empresaId]);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
