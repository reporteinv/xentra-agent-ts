"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentAuth = agentAuth;
const db_1 = __importDefault(require("../db"));
// Autenticacion de agentes via header X-Agent-Token, resolviendo
// empresa_id desde la tabla api_tokens (nunca confiar en el que
// declare el agente en el body). Fallback al AGENT_TOKEN legacy
// (una sola llave global, hoy usada solo por UNGRD) mientras se
// termina la migracion completa a tokens por cliente.
async function agentAuth(req, res, next) {
    const token = req.headers['x-agent-token'] || '';
    if (!token)
        return res.status(401).json({ error: 'Token requerido' });
    try {
        const [rows] = await db_1.default.query(`SELECT id, empresa_id, expira_en FROM api_tokens
       WHERE token=? AND activo=1
       AND (expira_en IS NULL OR expira_en >= CURDATE())`, [token]);
        const row = rows[0];
        if (row) {
            await db_1.default.query('UPDATE api_tokens SET ultimo_uso=NOW() WHERE id=?', [row.id]);
            req.apiEmpresaId = row.empresa_id;
            return next();
        }
        // Fallback legacy — deberia dejar de dispararse una vez todo
        // este migrado a api_tokens (ya insertamos el token de UNGRD ahi)
        if (token === process.env.AGENT_TOKEN) {
            console.warn('[agentAuth] Token legacy AGENT_TOKEN usado — deberia estar en api_tokens ya');
            req.apiEmpresaId = 26;
            return next();
        }
        return res.status(401).json({ error: 'Token invalido o expirado' });
    }
    catch (err) {
        res.status(500).json({ error: 'Error de autenticacion' });
    }
}
