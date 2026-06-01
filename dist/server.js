"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const logger_1 = require("./modules/logger");
const helmet = require("helmet");
const session = require("express-session");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();
const app = express();
app.set("trust proxy", 1);
const { rateLimit } = require("express-rate-limit");
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones, intenta más tarde' }
});
app.use(limiter);
const PORT = process.env.PORT || 3001;
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || "xentra_agent_secret_2026",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 },
}));
const USUARIO = "Ungrd";
const PASSWORD = "Ungrd.2026";
function requireAuth(req, res, next) {
    if (req.path === "/api/reportar")
        return next();
    if (req.path === "/api/evento-red")
        return next();
    if (req.path.startsWith("/api/comandos/") && req.method === "GET")
        return next();
    if (req.path === "/api/comandos/resultado")
        return next();
    if (req.method === "DELETE" && req.path.startsWith("/api/pcs/"))
        return next();
    if (req.path === "/api/programas")
        return next();
    if (req.path === "/api/stats/areas")
        return next();
    if (req.path === "/api/descargar-agente")
        return next();
    if (req.path === "/api/pc/reportar")
        return next();
    if (req.path === "/api/pcs")
        return next();
    if (req.path.startsWith("/api/pc/comandos"))
        return next();
    if (req.path === "/api/pc/programas")
        return next();
    if (req.path === "/api/pc/evento-red")
        return next();
    if (req.method === "GET" && req.path.match(/\/api\/pcs\/[^\/]+\/usb/))
        return next();
    if (req.path === "/login.html" ||
        req.path === "/api/login" ||
        req.path === "/api/logout")
        return next();
    if (req.path === "/favicon.ico")
        return next();
    if (req.path.startsWith("/assets/"))
        return next();
    if (!req.session.autenticado) {
        if (req.path.startsWith("/api/"))
            return res.status(401).json({ error: "No autenticado" });
        return res.redirect("/login.html");
    }
    next();
}
// Rutas públicas (sin autenticación)
app.get('/sw9k3', (req, res) => {
    if (!req.session?.autenticado)
        return res.redirect('/login.html');
    res.sendFile(path.join(__dirname, '../public/software.html'));
});
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.get('/api/metrics', (req, res, next) => next());
app.use((req, res, next) => {
    if (req.path === '/api/metrics')
        return next();
    requireAuth(req, res, next);
});
// No cachear JS y CSS para forzar actualizaciones
app.use((req, res, next) => {
    if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});
app.use(express.static(path.join(__dirname, "../public")));
// Rutas
const authRouter = require("./routes/auth");
const pcsRouter = require("./routes/pcs");
const statsRouter = require("./routes/stats");
const exportsRouter = require("./routes/exports");
const limpiezaRouter = require("./routes/limpieza");
const comandosRouter = require("./routes/comandos");
const agenteRouter = require("./routes/agente");
const licencias_1 = __importDefault(require("./routes/licencias"));
const software_1 = __importDefault(require("./routes/software"));
app.use(authRouter);
app.use(pcsRouter);
app.use(statsRouter);
app.use(exportsRouter);
app.use(limpiezaRouter);
app.use(comandosRouter);
app.use(agenteRouter);
app.use(licencias_1.default);
app.use(software_1.default);
app.get("/health", (req, res) => res.json({ ok: true, service: "xentra-agent-ts" }));
app.listen(PORT, () => (0, logger_1.logInfo)("SERVIDOR_INICIADO", { mensaje: `xentra-agent-ts corriendo en http://localhost:${PORT}` }));
const alertas_pcs_1 = require("./cron/alertas-pcs");
// Cron: verificar PCs sin reporte cada 60 minutos
setInterval(async () => {
    await (0, alertas_pcs_1.verificarPcsSinReporte)();
}, 60 * 60 * 1000);
// Ejecutar 30s despues de arrancar
setTimeout(async () => {
    await (0, alertas_pcs_1.verificarPcsSinReporte)();
}, 30 * 1000);
