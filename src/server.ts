import express = require("express");
import { logInfo, logError } from './modules/logger';
import helmet = require("helmet");
import session = require("express-session");
import path = require("path");
import dotenv = require("dotenv");
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

app.use((helmet as any)({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "xentra_agent_secret_2026",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 },
  }),
);

const USUARIO = "Ungrd";
const PASSWORD = "Ungrd.2026";

function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (req.path === "/api/reportar") return next();
  if (req.path === "/api/evento-red") return next();
  if (req.path.startsWith("/api/comandos/") && req.method === "GET")
    return next();
  if (req.path === "/api/comandos/resultado") return next();
  if (req.method === "DELETE" && req.path.startsWith("/api/pcs/"))
    return next();
  if (req.path === "/api/programas") return next();
  if (req.path === "/api/stats/areas") return next();
  if (req.path === "/api/descargar-agente") return next();
  if (req.path === "/api/pc/reportar") return next();
  if (req.path === "/api/pcs") return next();
  if (req.path.startsWith("/api/pc/comandos")) return next();
  if (req.path === "/api/pc/programas") return next();
  if (req.path === "/api/pc/evento-red") return next();
  if (req.method === "GET" && req.path.match(/\/api\/pcs\/[^\/]+\/usb/))
    return next();
  if (
    req.path === "/login.html" ||
    req.path === "/api/login" ||
    req.path === "/api/logout"
  )
    return next();
  if (req.path === "/favicon.ico") return next();
  if (req.path.startsWith("/assets/")) return next();
  if (!(req.session as any).autenticado) {
    if (req.path.startsWith("/api/"))
      return res.status(401).json({ error: "No autenticado" });
    return res.redirect("/login.html");
  }
  next();
}

// Rutas públicas (sin autenticación)
app.get('/sw9k3', (req: any, res: any) => {
  if (!req.session?.autenticado) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, '../public/software.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.get('/api/metrics', (req, res, next) => next());
app.use((req, res, next) => {
  if (req.path === '/api/metrics') return next();
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
import authRouter = require("./routes/auth");
import pcsRouter = require("./routes/pcs");
import statsRouter = require("./routes/stats");
import exportsRouter = require("./routes/exports");
import limpiezaRouter = require("./routes/limpieza");
import comandosRouter = require("./routes/comandos");
import agenteRouter = require("./routes/agente");
import licenciasRouter from "./routes/licencias";
import softwareRouter from "./routes/software";

app.use(authRouter);
app.use(pcsRouter);
app.use(statsRouter);
app.use(exportsRouter);
app.use(limpiezaRouter);
app.use(comandosRouter);
app.use(agenteRouter);
app.use(licenciasRouter);
app.use(softwareRouter);

app.get("/health", (req, res) =>
  res.json({ ok: true, service: "xentra-agent-ts" }),
);

app.listen(PORT, () =>
  logInfo("SERVIDOR_INICIADO", { mensaje: `xentra-agent-ts corriendo en http://localhost:${PORT}` }),
);

import { verificarPcsSinReporte } from './cron/alertas-pcs';

// Cron: verificar PCs sin reporte cada 60 minutos
setInterval(async () => {
  await verificarPcsSinReporte();
}, 60 * 60 * 1000);

// Ejecutar 30s despues de arrancar
setTimeout(async () => {
  await verificarPcsSinReporte();
}, 30 * 1000);
