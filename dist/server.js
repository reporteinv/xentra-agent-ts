"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();
const app = express();
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
app.use(requireAuth);
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
app.use(authRouter);
app.use(pcsRouter);
app.use(statsRouter);
app.use(exportsRouter);
app.use(limpiezaRouter);
app.use(comandosRouter);
app.use(agenteRouter);
app.get("/health", (req, res) => res.json({ ok: true, service: "xentra-agent-ts" }));
app.listen(PORT, () => console.log(`xentra-agent-ts corriendo en http://localhost:${PORT}`));
