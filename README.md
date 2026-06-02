# Xentrasoft — Plataforma de Monitoreo IT

> **Nueva Era Soluciones S.A.S.** · [xentrasoft.com](https://xentrasoft.com)  
> Plataforma multi-tenant para inventario de equipos, gestión de impresoras y monitoreo de PCs en tiempo real.

---

## Tabla de contenidos

1. [Descripción general](#descripción-general)
2. [Infraestructura](#infraestructura)
3. [Servicios por nodo](#servicios-por-nodo)
4. [Bases de datos](#bases-de-datos)
5. [Stack técnico](#stack-técnico)
6. [Proyectos](#proyectos)
7. [Agente PowerShell](#agente-powershell)
8. [API — Resumen de endpoints](#api--resumen-de-endpoints)
9. [Seguridad](#seguridad)
10. [Flujo de despliegue](#flujo-de-despliegue)
11. [Monitoreo y alertas](#monitoreo-y-alertas)
12. [Variables de entorno](#variables-de-entorno)
13. [Pendientes y roadmap](#pendientes-y-roadmap)

---

## Descripción general

Xentrasoft es una plataforma de administración IT desplegada on-premise sobre dos servidores ARM (Orange Pi). Gestiona:

- **Inventario de impresoras** — contadores, tóner, alertas por cliente (multi-tenant)
- **Monitoreo de PCs** — inventario de hardware/software, comandos remotos, limpieza de disco, garantías, eventos de red
- **Agente PowerShell** — instalado en cada equipo Windows, reporta hardware completo y recibe comandos remotos
- **API pública** — endpoints Bearer para integración con Power BI, GLPI u otros sistemas externos

Cliente principal: **UNGRD** (753 PCs activos).

---

## Infraestructura

| Nodo | Dispositivo | IP local | Dominio principal | Dominio secundario | Tunnel Cloudflare |
|---|---|---|---|---|---|
| Zero 3 | Orange Pi Zero 3 | 192.168.0.10 | `app.xentrasoft.com` | `agent.xentrasoft.com` | `499d6a9c-fe42-4575-8e46-662ee300974d` |
| Pi4 Pro | Orange Pi 4 Pro | 192.168.0.15 | `ts.xentrasoft.com` | `ag2.xentrasoft.com` | `3094643d-7977-48e6-be3e-7d0a511d7640` |

**Especificaciones Pi4 Pro:** 8 GB LPDDR5 · NVMe ADATA Legend 710 512 GB · Debian Bookworm (kernel 5.15)

### Acceso SSH

```bash
# Zero 3
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" orangepi@ssh.xentrasoft.com

# Pi4 Pro
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" orangepi@ssh4.xentrasoft.com
```

---

## Servicios por nodo

### Orange Pi Zero 3 — `192.168.0.10`

| PM2 ID | Nombre | Puerto | Descripción |
|---|---|---|---|
| 0 | `impresoras` | 3000 | Dashboard impresoras (producción) |
| 1 | `impresoras-dev` | 3001 | Entorno de desarrollo |
| 4 | `xentra-agent` | 4000 | Dashboard PCs UNGRD (producción Zero 3) |

### Orange Pi 4 Pro — `192.168.0.15`

| PM2 ID | Nombre | Puerto | Descripción |
|---|---|---|---|
| 0 | `impresoras-ts` | 3000 | Dashboard impresoras TypeScript |
| 1 | `xentra-agent-ts` | 3001 | Dashboard PCs UNGRD (principal) |

---

## Bases de datos

| Base de datos | Ubicación | Descripción |
|---|---|---|
| `impresoras_db` | Zero 3 | Datos de impresoras (producción) |
| `impresoras_db_dev` | Zero 3 | Datos de impresoras (desarrollo) |
| `agent_db` | Zero 3 | BD agente UNGRD — Zero 3 |
| `xentra_pcs_db` | Zero 3 | BD principal de PCs (accedida desde Pi4 Pro vía `xentra_remote`) |

### Tablas principales — `xentra_pcs_db`

| Tabla | Descripción |
|---|---|
| `pcs` | Inventario principal: serial, empresa, hardware, garantía, IP, disco, RAM |
| `pcs_programas` | Software instalado por PC |
| `programas_estado` | Clasificación GTI: permitido / sospechoso / bloqueado / driver |
| `pcs_historial_limpiezas` | Historial de limpiezas con MB liberados |
| `pcs_colores` | Color de fila por PC en el dashboard |
| `pcs_comandos` | Comandos remotos pendientes y su resultado |
| `pcs_eventos_red` | Eventos de red detectados por el agente |
| `campanas_limpieza` | Campañas de limpieza masiva |
| `api_tokens` | Tokens Bearer para API pública |
| `xentra_licencias` | Licencias de software por empresa |

---

## Stack técnico

| Componente | Tecnología |
|---|---|
| Runtime | Node.js 18+ |
| Lenguaje | TypeScript 5.x (`impresoras-ts`, `xentra-agent-ts`) |
| Framework | Express 4.x |
| Base de datos | MariaDB + `mysql2/promise` |
| Sesiones | `express-session` (MemoryStore) |
| Seguridad | `helmet`, `express-rate-limit`, HSTS, Zod schemas |
| 2FA | `speakeasy` (TOTP) |
| Logs | `logger.ts` JSON personalizado |
| Proceso | PM2 5.x |
| Tunnel | Cloudflare Tunnel (`cloudflared`) |
| Excel | `exceljs` |
| ZIP | `adm-zip` |
| Cron | `setInterval` nativo |

---

## Proyectos

### 1. `impresoras` — Zero 3, puerto 3000
Gestión de impresoras multi-tenant. Contadores, tóner, alertas, clientes, usuarios con RBAC.  
Ruta: `/var/www/impresoras`

### 2. `impresoras-ts` — Pi4 Pro, puerto 3000
Versión TypeScript de `impresoras`. Módulo dividido en 15+ archivos de rutas en `src/routes/`.  
Ruta: `/var/www/impresoras-ts`

> **Importante:** después de `npx tsc`, copiar manualmente `src/agents/` → `dist/agents/`

### 3. `xentra-agent` — Zero 3, puerto 4000
Servidor de monitoreo de PCs. **Producción UNGRD en Zero 3. No modificar.**  
Ruta: `/var/www/xentra-agent`

### 4. `xentra-agent-ts` — Pi4 Pro, puerto 3001
Versión principal y activa de monitoreo de PCs. TypeScript, todas las funciones nuevas se implementan aquí.  
Ruta: `/var/www/xentra-agent-ts`

```
/var/www/xentra-agent-ts/
├── src/
│   ├── server.ts          # Entrada principal
│   ├── db.ts              # Pool de conexión MySQL
│   ├── modules/
│   │   ├── logger.ts      # Logger JSON
│   │   ├── ip-lookup.ts   # Geolocalización IP (ip.guide)
│   │   └── lenovo-lookup.ts
│   ├── cron/
│   │   └── alertas-pcs.ts # Alerta PCs sin reporte >1 día
│   ├── middleware/
│   │   └── apiAuth.ts     # Autenticación Bearer
│   └── routes/
│       ├── auth.ts
│       ├── pcs.ts
│       ├── stats.ts
│       ├── comandos.ts
│       ├── limpieza.ts
│       ├── licencias.ts
│       ├── software.ts
│       ├── exports.ts
│       ├── tokens.ts
│       └── public.ts
├── public/                # Frontend estático
│   └── downloads/         # Agente PS1 + ZIP instalador
├── dist/                  # JS compilado
└── .env
```

---

## Agente PowerShell

**Versión actual: 3.8** · Archivo: `xentra-agent.ps1`

### Modos de operación

| Modo | Tarea programada | Descripción |
|---|---|---|
| Normal | `XentraAgent` (intervalo dinámico) | Recolecta hardware completo y reporta si el hash SHA256 cambió |
| Poll | `XentraAgentPoll` (cada 1 min) | Consulta comandos pendientes, monitor de red, verificación de tareas |

### Datos recolectados

- **Hardware:** RAM (total/libre/por slot), CPU (modelo/temp), GPU, motherboard, BIOS
- **Disco:** por letra — marca, tipo, bus, total GB, libre GB, temperatura, horas de uso
- **Red:** IP local, MAC, tipo (WiFi/Ethernet), adaptador, velocidad
- **Software:** versión Windows, Office, antivirus, uptime
- **Monitores:** resolución por pantalla
- **Garantía:** HP vía HPCMSL, Lenovo vía lookup, Dell (pendiente TechDirect)
- **Programas:** lista completa con nombre, fabricante, versión
- **Eventos de red:** fallos DHCP, conflictos IP (Event IDs 27/4199/8001/8003)

### Comandos remotos soportados

| Comando | Descripción |
|---|---|
| `limpiar` | Limpieza de disco (Temp, Papelera, WER, logs) |
| `reiniciar` | Reinicia el equipo |
| `apagar` | Apaga el equipo |
| `screenshot` | Captura pantalla y la envía al servidor |
| `ejecutar_script` | Ejecuta script PS1 remoto |
| `actualizar_agente` | Descarga e instala nueva versión |
| `reporte_ahora` | Fuerza reporte inmediato de inventario |
| `Cambiar-Intervalo` | Cambia el intervalo de reporte (minutos) |

---

## API — Resumen de endpoints

### `ag2.xentrasoft.com` — xentra-agent-ts (Pi4 Pro :3001)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/pc/reportar` | Token | Agente envía inventario |
| GET | `/api/pcs` | Sesión | Lista PCs activos |
| GET | `/api/pcs/:serial/detalle` | Sesión | Detalle completo de un PC |
| GET | `/api/comandos/:serial` | Token | Agente consulta comandos pendientes |
| POST | `/api/comandos/crear` | Sesión | Panel crea comando remoto |
| GET | `/api/stats/resumen` | Sesión | KPIs del dashboard |
| GET | `/api/public/pcs` | Bearer | Inventario completo (API pública) |
| GET | `/api/public/stats` | Bearer | Resumen ejecutivo (API pública) |
| GET | `/api/public/programas` | Bearer | Software instalado con filtros |
| GET | `/api/licencias` | Sesión | Listar licencias de software |
| GET | `/api/export/pcs-excel` | Sesión | Exportar inventario a Excel |
| GET | `/health` | No | Estado del servicio |
| GET | `/api/metrics` | Sesión | Métricas del servidor |

**Autenticación:**
- `Sesión` — cookie de sesión (login web)
- `Token` — header `x-agent-token`
- `Bearer` — header `Authorization: Bearer xnt_...`

**Ejemplo API pública:**
```bash
curl -H "Authorization: Bearer xnt_pub_ungrd_2026" \
  https://ag2.xentrasoft.com/api/public/stats
```

---

## Seguridad

| Mecanismo | Implementación |
|---|---|
| Autenticación web | `express-session` con `SESSION_SECRET`, cookie `httpOnly` |
| 2FA | `speakeasy` TOTP — campos `totp_secret`, `totp_activo`, `totp_forzado` en `usuarios` |
| Rate limiting | `express-rate-limit` por IP |
| HSTS | `helmet` con `Strict-Transport-Security` |
| Agente PS1 | Header `x-agent-token` verificado en cada endpoint |
| API pública | Bearer token filtrado por `empresa_id` |
| Soft delete | Campo `deleted_at` — PCs no se borran físicamente |
| Audit trail | Registro de cambios en rutas críticas |
| Validación | Zod schemas en endpoints críticos |

---

## Flujo de despliegue

### xentra-agent-ts (Pi4 Pro)

```bash
# 1. Editar fuentes
vim src/routes/xxx.ts

# 2. Compilar TypeScript
npx tsc

# 3. Copiar agentes (manual — no los compila tsc)
cp src/agents/* dist/agents/

# 4. Reiniciar servicio
pm2 flush && pm2 restart xentra-agent-ts

# 5. Verificar logs
pm2 logs xentra-agent-ts --lines 20 --nostream

# 6. Commit y push
git add -A && git commit -m "descripción" && git push
```

> **Nota:** `impresoras-ts` sigue el mismo flujo. El entorno dev (`/var/www/impresoras-dev`) no es un repo git — sincronizar manualmente antes de hacer push desde producción.

---

## Monitoreo y alertas

| Sistema | Descripción |
|---|---|
| Cron alertas PCs | Cada 60 min — alerta vía WhatsApp si un PC no reporta en >1 día |
| CallMeBot | WhatsApp API para notificaciones automáticas |
| `/health` | Endpoint de salud — retorna `{ ok: true }` |
| `/api/metrics` | Métricas del servidor en tiempo real |
| PM2 | Reinicio automático en crash, logs en `~/.pm2/logs/` |
| Polling frontend | Dashboard hace fetch `/api/pcs` cada 15s, flash verde en filas actualizadas |
| Backup semanal | SQL dump + git push — viernes 9pm (cron automático) |

---

## Variables de entorno

Crear `.env` en la raíz del proyecto. Ver `.env.example` para referencia.

### xentra-agent-ts

```env
PORT=3001
DB_HOST=192.168.0.10
DB_USER=xentra_remote
DB_PASS=xentra2026
DB_NAME=xentra_pcs_db
SESSION_SECRET=xentrasoft_session_secret_2026
AGENT_TOKEN=xnt_ungrd_2026
CALLMEBOT_PHONE=573508668200
CALLMEBOT_APIKEY=4169255
```

---

## Pendientes y roadmap

| ID | Tarea | Estado |
|---|---|---|
| P-01 | Logos de clientes faltantes | Pendiente |
| P-02 | Scrollbars más gruesas en tablas | Pendiente |
| P-06 | Alta disponibilidad — replicación MariaDB Zero3→Pi4Pro + Uptime Kuma | Pendiente |
| P-07 | Integración garantía Dell vía TechDirect API | En espera |
| R-01 | SNMP para contadores automáticos de impresoras | Pendiente |
| A-03 | Comando `GET_LOGS` — agente envía logs remotamente | Pendiente |
| A-04 | Comando `GET_PROCESSES` — agente envía procesos activos | Pendiente |
| D-01 | README.md con arquitectura en GitHub | ✅ Este archivo |
| D-03 | `.env.example` + diagrama de red | Pendiente |

---

*Xentrasoft · Nueva Era Soluciones S.A.S. · Actualizado 02/06/2026*
