"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificarPcsSinReporte = verificarPcsSinReporte;
const nodemailer = __importStar(require("nodemailer"));
const logger_1 = require("../modules/logger");
const https = __importStar(require("https"));
const pool = require("../db");
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});
async function enviarWhatsApp(mensaje) {
    const phone = process.env.CALLMEBOT_PHONE;
    const apikey = process.env.CALLMEBOT_APIKEY;
    if (!phone || !apikey)
        return;
    const texto = encodeURIComponent(mensaje);
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${texto}&apikey=${apikey}`;
    await new Promise((resolve) => {
        https.get(url, () => resolve()).on('error', () => resolve());
    });
}
async function verificarPcsSinReporte() {
    try {
        const [pcs] = await pool.query(`
      SELECT nombre_equipo, usuario, ultimo_reporte,
        TIMESTAMPDIFF(MINUTE, ultimo_reporte, NOW()) AS minutos_sin_reporte
      FROM pcs
      WHERE activo = 1
        AND ultimo_reporte < DATE_SUB(NOW(), INTERVAL 1 HOUR)
        AND ultimo_reporte >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
      ORDER BY minutos_sin_reporte DESC
    `);
        if (pcs.length === 0)
            return;
        const lista = pcs.map(pc => `- ${pc.nombre_equipo} (${pc.usuario}) sin reporte hace ${pc.minutos_sin_reporte} min`).join('\n');
        const asunto = `Xentrasoft: ${pcs.length} PC(s) sin reporte`;
        const texto = `PCs sin reporte en la ultima hora:\n\n${lista}\n\nVerifica conectividad o estado del agente.`;
        await transporter.sendMail({
            from: 'Xentrasoft <reporte@xentrasoft.com>',
            to: process.env.ALERT_EMAIL,
            subject: asunto,
            text: texto
        });
        await enviarWhatsApp(`Xentrasoft: ${pcs.length} PC(s) sin reporte hace >1h. Revisa el dashboard.`);
        (0, logger_1.logInfo)('ALERTA_PCS', { mensaje: `${pcs.length} PCs sin reporte — alerta enviada` });
    }
    catch (e) {
        (0, logger_1.logError)('ALERTA_PCS_ERROR', e.message);
    }
}
