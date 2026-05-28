import express = require("express");
import helmet = require("helmet");
import session = require("express-session");
import path = require("path");
import dotenv = require("dotenv");
dotenv.config();

const app = express();
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

app.use(requireAuth);
app.use(express.static(path.join(__dirname, "../public")));

// Rutas
import authRouter = require("./routes/auth");
import pcsRouter = require("./routes/pcs");
import statsRouter = require("./routes/stats");
import exportsRouter = require("./routes/exports");
import limpiezaRouter = require("./routes/limpieza");
import comandosRouter = require("./routes/comandos");
import agenteRouter = require("./routes/agente");

app.use(authRouter);
app.use(pcsRouter);
app.use(statsRouter);
app.use(exportsRouter);
app.use(limpiezaRouter);
app.use(comandosRouter);
app.use(agenteRouter);

app.get("/health", (req, res) =>
  res.json({ ok: true, service: "xentra-agent-ts" }),
);

app.listen(PORT, () =>
  console.log(`xentra-agent-ts corriendo en http://localhost:${PORT}`),
);
