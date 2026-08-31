"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../db"));
const router = express_1.default.Router();
const SERVIDOR_DEFAULT = 'https://ts.xentrasoft.com'; // servidor de produccion real del agente Go (ag2 es solo el entorno de prueba)
function authCheck(req, res, next) {
    if (!req.session?.autenticado)
        return res.status(401).json({ error: 'No autenticado' });
    next();
}
// GET — genera el instalador .bat del agente Go para un cliente especifico
// Reusa un token activo existente si lo hay; si no, genera uno nuevo.
router.get('/api/pc/instalador-go/:empresa_id', authCheck, async (req, res) => {
    try {
        const empresaId = parseInt(req.params.empresa_id, 10);
        if (isNaN(empresaId))
            return res.status(400).json({ error: 'empresa_id invalido' });
        const servidor = req.query.servidor || SERVIDOR_DEFAULT;
        const [rows] = await db_1.default.query(`SELECT token FROM api_tokens WHERE empresa_id=? AND activo=1 ORDER BY created_at DESC LIMIT 1`, [empresaId]);
        let token;
        if (rows.length > 0) {
            token = rows[0].token;
        }
        else {
            token = 'xnt_' + crypto_1.default.randomBytes(24).toString('hex');
            await db_1.default.query(`INSERT INTO api_tokens (empresa_id, token, descripcion) VALUES (?,?,?)`, [empresaId, token, 'Instalador Go - generado automaticamente']);
        }
        const plantillaPath = path_1.default.join(__dirname, '../agents/setup-go.bat.template');
        let contenido = fs_1.default.readFileSync(plantillaPath, 'utf8');
        contenido = contenido
            .replace(/__XENTRA_TOKEN__/g, token)
            .replace(/__XENTRA_SERVER__/g, servidor);
        res.setHeader('Content-Disposition', `attachment; filename="xentra-agent-go-${empresaId}.bat"`);
        res.setHeader('Content-Type', 'application/octet-stream; charset=utf-8');
        res.send(contenido);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
