"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agregarCliente = agregarCliente;
exports.emitirEvento = emitirEvento;
const clientes = new Map();
function agregarCliente(id, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('data: {"tipo":"conectado"}\n\n');
    clientes.set(id, res);
    res.on('close', () => { clientes.delete(id); });
}
function emitirEvento(evento, datos) {
    const msg = `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
    clientes.forEach(res => { try {
        res.write(msg);
    }
    catch { } });
}
