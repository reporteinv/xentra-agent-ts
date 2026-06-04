import { Router, Request, Response } from 'express'
import pool = require('../db')


const router = Router()

// ============================================================
//  POST /api/impresora/snmp-reporte
//  Recibe datos SNMP de impresoras + trabajos de impresion
//  Auth: x-agent-token
// ============================================================
router.post('/snmp-reporte', async (req: Request, res: Response) => {
  try {
    const token = req.headers["x-agent-token"];
    if (token !== process.env.AGENT_TOKEN)
      return res.status(401).json({ error: "Token invalido" });
    const { serial, empresa_id, impresoras, trabajos, timestamp } = req.body

    if (!serial || !empresa_id) {
      return res.status(400).json({ ok: false, error: 'serial y empresa_id requeridos' })
    }

    const conn = await pool.getConnection()
    let impresorasOk = 0
    let trabajosOk   = 0
    let alertas: string[] = []

    // ?????? Impresoras SNMP ????????????????????????????????????????????????????????????????????????????????????????????????????????????
    if (Array.isArray(impresoras) && impresoras.length > 0) {
      for (const imp of impresoras) {
        // Extraer toner por color
        let tonerBlack    = null
        let tonerCyan     = null
        let tonerMagenta  = null
        let tonerYellow   = null

        if (Array.isArray(imp.toner)) {
          for (const t of imp.toner) {
            const c = (t.color || '').toLowerCase()
            if (c.includes('black') || c.includes('negro') || c.includes('bk')) tonerBlack   = t.pct
            else if (c.includes('cyan')    || c.includes('cy'))                 tonerCyan    = t.pct
            else if (c.includes('magenta') || c.includes('mg'))                 tonerMagenta = t.pct
            else if (c.includes('yellow')  || c.includes('amarillo') || c.includes('yl')) tonerYellow = t.pct
          }
        }

        // Alerta si algun toner < 15%
        const alertaToner = [tonerBlack, tonerCyan, tonerMagenta, tonerYellow]
          .some(v => v !== null && v < 15) ? 1 : 0

        if (alertaToner) {
          const coloresLow = imp.toner
            .filter((t: any) => t.pct < 15)
            .map((t: any) => `${t.color} ${t.pct}%`)
            .join(', ')
          alertas.push(`${imp.modelo || imp.ip}: ${coloresLow}`)
        }

        // UPSERT por empresa_id + ip
        await conn.query(`
          INSERT INTO snmp_impresoras
            (empresa_id, serial_pc, ip, nombre_win, marca, modelo, serial,
             total_paginas, paginas_bn, paginas_color,
             papel_nivel, papel_max,
             toner_black, toner_cyan, toner_magenta, toner_yellow,
             alerta_toner, ultima_lectura)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            serial_pc     = VALUES(serial_pc),
            nombre_win    = VALUES(nombre_win),
            marca         = VALUES(marca),
            modelo        = VALUES(modelo),
            serial        = VALUES(serial),
            total_paginas = VALUES(total_paginas),
            paginas_bn    = VALUES(paginas_bn),
            paginas_color = VALUES(paginas_color),
            papel_nivel   = VALUES(papel_nivel),
            papel_max     = VALUES(papel_max),
            toner_black   = VALUES(toner_black),
            toner_cyan    = VALUES(toner_cyan),
            toner_magenta = VALUES(toner_magenta),
            toner_yellow  = VALUES(toner_yellow),
            alerta_toner  = VALUES(alerta_toner),
            ultima_lectura= VALUES(ultima_lectura)
        `, [
          empresa_id, serial, imp.ip, imp.nombre_win || null,
          imp.marca || null, imp.modelo || null, imp.serial || null,
          imp.total_paginas || null, imp.paginas_bn || null, imp.paginas_color || null,
          imp.papel_nivel || null, imp.papel_max || null,
          tonerBlack, tonerCyan, tonerMagenta, tonerYellow,
          alertaToner,
          imp.timestamp ? new Date(imp.timestamp) : new Date()
        ])

        impresorasOk++
      }
    }

    // ?????? Trabajos de impresion ??????????????????????????????????????????????????????????????????????????????????????????
    if (Array.isArray(trabajos) && trabajos.length > 0) {
      for (const t of trabajos) {
        if (!t.fecha || !t.usuario) continue
        await conn.query(`
          INSERT IGNORE INTO snmp_trabajos_impresion
            (empresa_id, serial_pc, fecha, usuario, impresora, paginas, documento)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          empresa_id, serial,
          new Date(t.fecha),
          t.usuario || null,
          t.impresora || null,
          t.paginas || 0,
          t.documento || null
        ])
        trabajosOk++
      }
    }

    conn.release()

    return res.json({
      ok:          true,
      impresoras:  impresorasOk,
      trabajos:    trabajosOk,
      alertas:     alertas,
      hay_alertas: alertas.length > 0
    })

  } catch (err: any) {
    console.error('[snmp-reporte]', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ============================================================
//  GET /api/impresora/lista
//  Devuelve impresoras registradas de una empresa
//  Auth: sesion
// ============================================================
router.get('/lista', async (req: Request, res: Response) => {
  try {
    const { empresa_id } = req.query
    if (!empresa_id) return res.status(400).json({ ok: false, error: 'empresa_id requerido' })

    const conn = await pool.getConnection()
    const [rows] = await conn.query(`
      SELECT
        ip, nombre_win, marca, modelo, serial,
        total_paginas, paginas_bn, paginas_color,
        papel_nivel, papel_max,
        toner_black, toner_cyan, toner_magenta, toner_yellow,
        alerta_toner, ultima_lectura, updated_at
      FROM snmp_impresoras
      WHERE empresa_id = ?
      ORDER BY marca, modelo
    `, [empresa_id]) as any[]
    conn.release()

    return res.json({ ok: true, impresoras: rows })
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ============================================================
//  GET /api/impresora/trabajos
//  Devuelve trabajos de impresion de una empresa
//  Auth: sesion
// ============================================================
router.get('/trabajos', async (req: Request, res: Response) => {
  try {
    const { empresa_id, dias = 7 } = req.query
    if (!empresa_id) return res.status(400).json({ ok: false, error: 'empresa_id requerido' })

    const conn = await pool.getConnection()
    const [rows] = await conn.query(`
      SELECT
        serial_pc, fecha, usuario, impresora, paginas, documento
      FROM snmp_trabajos_impresion
      WHERE empresa_id = ?
        AND fecha >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY fecha DESC
      LIMIT 500
    `, [empresa_id, dias]) as any[]
    conn.release()

    // Agrupar paginas por usuario
    const porUsuario: Record<string, number> = {}
    for (const r of rows) {
      porUsuario[r.usuario] = (porUsuario[r.usuario] || 0) + (r.paginas || 0)
    }

    return res.json({
      ok:         true,
      trabajos:   rows,
      por_usuario: porUsuario
    })
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ============================================================
//  GET /api/impresora/alertas
//  Devuelve impresoras con toner bajo
// ============================================================
router.get('/alertas', async (req: Request, res: Response) => {
  try {
    const { empresa_id } = req.query
    if (!empresa_id) return res.status(400).json({ ok: false, error: 'empresa_id requerido' })

    const conn = await pool.getConnection()
    const [rows] = await conn.query(`
      SELECT ip, nombre_win, marca, modelo,
             toner_black, toner_cyan, toner_magenta, toner_yellow,
             ultima_lectura
      FROM snmp_impresoras
      WHERE empresa_id = ?
        AND alerta_toner = 1
      ORDER BY ultima_lectura DESC
    `, [empresa_id]) as any[]
    conn.release()

    return res.json({ ok: true, alertas: rows })
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

export default router
