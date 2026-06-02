"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiAuth = apiAuth;
const db_1 = __importDefault(require("../db"));
async function apiAuth(req, res, next) {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token)
        return res.status(401).json({ error: 'Token requerido' });
    try {
        const [rows] = await db_1.default.query(`SELECT id, empresa_id, expira_en FROM api_tokens
       WHERE token=? AND activo=1
       AND (expira_en IS NULL OR expira_en >= CURDATE())`, [token]);
        const row = rows[0];
        if (!row)
            return res.status(401).json({ error: 'Token invalido o expirado' });
        await db_1.default.query('UPDATE api_tokens SET ultimo_uso=NOW() WHERE id=?', [row.id]);
        req.apiEmpresaId = row.empresa_id;
        next();
    }
    catch (err) {
        res.status(500).json({ error: 'Error de autenticacion' });
    }
}
