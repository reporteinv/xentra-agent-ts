"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.consultarLenovo = consultarLenovo;
exports.lookupYActualizar = lookupYActualizar;
const axios_1 = __importDefault(require("axios"));
const pool = require("../db");
function calcularStatus(fechaFin) {
    const hoy = new Date();
    const fin = new Date(fechaFin.split('/').reverse().join('-'));
    const diffDias = Math.floor((fin.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDias < 0)
        return 'vencida';
    if (diffDias <= 180)
        return 'por_vencer';
    return 'vigente';
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function consultarLenovo(serial) {
    const intentos = 3;
    const delays = [2000, 5000, 10000];
    for (let i = 0; i < intentos; i++) {
        try {
            const url = `https://warranty-check.sigatics.com/warranty/${serial}`;
            const resp = await axios_1.default.get(url, { timeout: 8000 });
            if (resp.data && resp.data['Product Name']) {
                return {
                    brand: resp.data['Brand'],
                    productName: resp.data['Product Name'],
                    serialNumber: resp.data['Serial Number'],
                    warrantyStart: resp.data['Warranty Start'],
                    warrantyEnd: resp.data['Warranty End']
                };
            }
        }
        catch (err) {
            console.warn(`[lenovo-lookup] Intento ${i + 1}/3 fallido para serial ${serial}`);
        }
        if (i < intentos - 1)
            await sleep(delays[i]);
    }
    console.error(`[lenovo-lookup] Serial ${serial} fallido tras 3 intentos`);
    return null;
}
async function lookupYActualizar(pcId, serial, marca) {
    // Detectar Lenovo por marca O por serial (seriales Lenovo empiezan con MJ)
    const esLenovo = (marca && marca.toLowerCase().includes('lenovo')) ||
        (serial && serial.toUpperCase().startsWith('MJ'));
    if (!esLenovo) {
        const [rows] = await pool.query(`SELECT garantia_status FROM pcs WHERE id = ?`, [pcId]);
        const yaTieneGarantia = rows[0]?.garantia_status != null;
        const nuevoStatus = yaTieneGarantia ? 'ok' : 'no_soportado';
        await pool.query(`UPDATE pcs SET lookup_status = ? WHERE id = ?`, [nuevoStatus, pcId]);
        return;
    }
    const datos = await consultarLenovo(serial);
    if (!datos) {
        await pool.query(`UPDATE pcs SET lookup_status = 'error', lookup_fecha = NOW() WHERE id = ?`, [pcId]);
        return;
    }
    const toISO = (f) => f.split('/').reverse().join('-');
    const status = calcularStatus(datos.warrantyEnd);
    await pool.query(`UPDATE pcs SET
      modelo_oficial = ?,
      garantia_inicio = ?,
      garantia_fin = ?,
      garantia_status = ?,
      lookup_fecha = NOW(),
      lookup_status = 'ok'
    WHERE id = ?`, [datos.productName, toISO(datos.warrantyStart), toISO(datos.warrantyEnd), status, pcId]);
}
