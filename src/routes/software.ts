import { Router, Request, Response } from 'express';
import pool from '../db';
import { logError } from '../modules/logger';

const router = Router();

const EXCLUIR = [
  /^microsoft visual c\+\+/i,/^microsoft \.net/i,/^microsoft asp\.net/i,
  /^microsoft windows desktop runtime/i,/^microsoft \.net apphost/i,
  /^microsoft \.net host/i,/^microsoft \.net runtime/i,
  /^microsoft\.net\./i,/^microsoft\.aspnetcore/i,/^microsoft\.windowsdesktop/i,
  /^adobe refresh manager/i,/^google update helper/i,/^java auto updater/i,
  /^microsoft update health/i,/^teams machine-wide installer/i,
  /^office 16 click-to-run/i,/\bKB\d+\b/i,/^update for /i,
  /^cumulative update/i,/^security update for/i,/^definition update/i,
  /^service pack \d/i,/^update for x64-based/i,/^update for windows/i,
  /^microsoft edge/i,/webview2/i,/^copilot/i,/^microsoft search in bing/i,
  /^windows subsystem/i,/^dynamic application loader/i,/^msxml/i,
  /^glpi agent/i,/^realtek audio/i,/^microsoft office proof/i,
  /^microsoft office proofing/i,/^microsoft office shared/i,
  /^outils de v.rification/i,/^ferramentas de verifica/i,
  /^eines de correcci/i,/^revisores de texto/i,
  /^aplicaciones de microsoft 365/i,/^microsoft 365 -/i,/^asian language/i,
];

const GRUPOS: { key: string; label: string; fabricante: string; regex: RegExp }[] = [
  { key:'office',     label:'Microsoft Office',     fabricante:'Microsoft Corporation', regex:/^microsoft office|^microsoft teams meeting add-in/i },
  { key:'teams',      label:'Microsoft Teams',      fabricante:'Microsoft Corporation', regex:/^microsoft teams|^teams machine/i },
  { key:'onedrive',   label:'Microsoft OneDrive',   fabricante:'Microsoft Corporation', regex:/^microsoft onedrive/i },
  { key:'sharepoint', label:'Microsoft SharePoint', fabricante:'Microsoft Corporation', regex:/^microsoft sharepoint/i },
  { key:'powerbi',    label:'Microsoft Power BI',   fabricante:'Microsoft Corporation', regex:/^microsoft power bi/i },
  { key:'kaspersky',  label:'Kaspersky',             fabricante:'Kaspersky',             regex:/^kaspersky/i }, // auto-permitido
  { key:'adobe_ac',   label:'Adobe Acrobat',         fabricante:'Adobe',                 regex:/^adobe acrobat/i },
  { key:'adobe',      label:'Adobe',                 fabricante:'Adobe',                 regex:/^adobe/i },
  { key:'chrome',     label:'Google Chrome',         fabricante:'Google LLC',            regex:/^google chrome/i },
  { key:'gdrive',     label:'Google Drive',           fabricante:'Google LLC',            regex:/^google drive/i },
  { key:'firefox',    label:'Mozilla Firefox',       fabricante:'Mozilla',               regex:/^mozilla firefox|^mozilla maintenance/i },
  { key:'zip',        label:'7-Zip',                 fabricante:'Igor Pavlov',           regex:/^7-zip/i },
  { key:'winrar',     label:'WinRAR',                fabricante:'win.rar GmbH',          regex:/^winrar/i },
  { key:'pdf24',      label:'PDF24 Creator',         fabricante:'Geek Software GmbH',    regex:/^pdf24/i },
  { key:'python',     label:'Python',                fabricante:'Python Software Foundation', regex:/^python/i },
  { key:'java',       label:'Java',                  fabricante:'Oracle',                regex:/^java/i },
  { key:'canon',      label:'Canon',                 fabricante:'Canon',                 regex:/^canon|^scanserver|^captureontouch/i },
  { key:'epson',      label:'Epson',                 fabricante:'Epson',                 regex:/^epson|^document capture pro/i },
  { key:'toshiba',    label:'TOSHIBA',               fabricante:'Toshiba',               regex:/^toshiba/i },
  { key:'elogic',     label:'Elogic Monitor',        fabricante:'',                      regex:/^elogic monitor/i },
  { key:'crystaldisk', label:'CrystalDiskInfo',         fabricante:'Crystal Dew World',     regex:/^crystaldiskinfo/i },
];

const FABRICANTES_DRIVER = [
  /^nvidia/i,/^intel\(r\)/i,/^intel /i,/^advanced micro devices/i,
  /^amd /i,/^realtek/i,/^qualcomm/i,/^broadcom/i,/^synaptics/i,
  /^samsung electronics/i,/^lenovo/i,/^dell /i,/^hewlett/i,
];

const NOMBRES_DRIVER = [
  /^nvidia/i,/^intel\(r\)/i,/^amd software/i,/^amd chipset/i,
  /^amd ryzen/i,/^amd sbxxx/i,/^realtek/i,/^lenovo system/i,/^lenovo /i,
  /^branding64/i,/^ryzenmaster/i,
];

function esDriver(nombre: string, fabricante: string): boolean {
  return FABRICANTES_DRIVER.some(r => r.test(fabricante)) || NOMBRES_DRIVER.some(r => r.test(nombre));
}

function esExcluido(nombre: string): boolean {
  return EXCLUIR.some(r => r.test(nombre));
}

router.get('/api/stats/programas-raros', async (req: Request, res: Response) => {
  try {
    const [rows]: any = await pool.query(`
      SELECT
        pp.nombre, pp.fabricante,
        COUNT(DISTINCT pp.pc_id) AS total_pcs,
        GROUP_CONCAT(DISTINCT
          CASE
            WHEN p.usuario LIKE '%Recepcion%' OR p.usuario LIKE '%alas' THEN 'Admin'
            WHEN p.usuario LIKE '%Asesor%' THEN 'SecGeneral'
            WHEN p.usuario LIKE '%Infopu%' THEN 'Comunicaciones'
            WHEN p.usuario LIKE '%ProyectosE%' THEN 'Reduccion'
            WHEN p.usuario REGEXP '_[A-Za-z]+$' THEN SUBSTRING_INDEX(p.usuario, '_', -1)
            ELSE 'Otros'
          END
        SEPARATOR ' / ') AS areas,
        CONCAT(
          SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT SUBSTRING_INDEX(COALESCE(p.usuario,''), '\\\\', -1) ORDER BY p.usuario SEPARATOR ' / '), ' / ', 3),
          CASE WHEN COUNT(DISTINCT pp.pc_id) > 3 THEN CONCAT(' ... +', COUNT(DISTINCT pp.pc_id)-3, ' más') ELSE '' END
        ) AS usuarios,
        COALESCE(pe.estado, 'sospechoso') AS estado_manual,
        CASE WHEN pe.id IS NOT NULL THEN 1 ELSE 0 END AS manual
      FROM pcs_programas pp
      JOIN pcs p ON p.id = pp.pc_id
      LEFT JOIN programas_estado pe ON pe.nombre = pp.nombre
      WHERE p.activo = 1 AND p.deleted_at IS NULL
      GROUP BY pp.nombre, pp.fabricante, pe.estado
    `);

    const grupoMap: Record<string, any> = {};
    const sinGrupo: any[] = [];

    for (const row of rows) {
      if (esExcluido(row.nombre)) continue;
      let estado = row.estado_manual;
      if (!row.manual) {
        if (esDriver(row.nombre, row.fabricante || '')) estado = 'driver';
        else if (/^kaspersky/i.test(row.nombre)) estado = 'permitido';
        else if (/^7-zip|^winrar|^pdf24|^foxit pdf|^notepad\+\+|^google chrome|^mozilla firefox|^google drive|^vlc|^zoom/i.test(row.nombre)) estado = 'permitido';
        else estado = 'sospechoso';
      }
      row.estado = estado;

      const grupo = GRUPOS.find(g => g.regex.test(row.nombre));
      if (grupo) {
        if (!grupoMap[grupo.key]) {
          grupoMap[grupo.key] = {
            nombre: grupo.label, fabricante: grupo.fabricante || row.fabricante,
            total_pcs: row.total_pcs, areas: row.areas, usuarios: row.usuarios,
            estado: row.manual ? row.estado_manual : (esDriver(grupo.label, grupo.fabricante) ? 'driver' : (/^kaspersky/i.test(grupo.label) ? 'permitido' : row.estado)),
            manual: row.manual, _grupo: true,
          };
        } else {
          grupoMap[grupo.key].total_pcs = Math.max(grupoMap[grupo.key].total_pcs, row.total_pcs);
          if (row.manual) grupoMap[grupo.key].estado = row.estado_manual;
        }
      } else {
        sinGrupo.push({ ...row });
      }
    }

    const programas = [
      ...sinGrupo,
      ...GRUPOS.filter(g => grupoMap[g.key]).map(g => grupoMap[g.key]),
    ].sort((a: any, b: any) => a.nombre.localeCompare(b.nombre));

    const kpis = {
      sospechosos: programas.filter((p: any) => p.estado === 'sospechoso').length,
      permitidos:  programas.filter((p: any) => p.estado === 'permitido').length,
      bloqueados:  programas.filter((p: any) => p.estado === 'bloqueado').length,
      drivers:     programas.filter((p: any) => p.estado === 'driver').length,
    };

    res.json({ kpis, programas });
  } catch (err: any) {
    logError('GET_PROGRAMAS_RAROS', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/programas-raros/estado', async (req: Request, res: Response) => {
  try {
    const { nombre, fabricante, estado, actualizado_por } = req.body;
    if (!nombre || !['sospechoso','permitido','bloqueado','driver'].includes(estado))
      return res.status(400).json({ error: 'Datos invalidos' });

    const [matches]: any = await pool.query(
      'SELECT DISTINCT nombre, fabricante FROM pcs_programas WHERE nombre = ? OR nombre LIKE ?',
      [nombre, nombre + '%']
    );

    if (matches.length > 0) {
      for (const m of matches) {
        await pool.query(`
          INSERT INTO programas_estado (nombre, fabricante, estado, actualizado_por)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE estado=VALUES(estado), actualizado_por=VALUES(actualizado_por)
        `, [m.nombre, m.fabricante || null, estado, actualizado_por || 'GTI']);
      }
    } else {
      await pool.query(`
        INSERT INTO programas_estado (nombre, fabricante, estado, actualizado_por)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE estado=VALUES(estado), actualizado_por=VALUES(actualizado_por)
      `, [nombre, fabricante || null, estado, actualizado_por || 'GTI']);
    }

    res.json({ ok: true });
  } catch (err: any) {
    logError('POST_PROGRAMAS_ESTADO', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
