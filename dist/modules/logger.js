"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = log;
exports.logInfo = logInfo;
exports.logError = logError;
exports.logWarn = logWarn;
function log(entrada) {
    const registro = {
        timestamp: new Date().toISOString(),
        nivel: entrada.nivel || 'info',
        evento: entrada.evento,
        ...(entrada.mensaje && { mensaje: entrada.mensaje }),
        ...(entrada.usuario && { usuario: entrada.usuario }),
        ...(entrada.pc && { pc: entrada.pc }),
        ...(entrada.endpoint && { endpoint: entrada.endpoint }),
        ...(entrada.error && { error: entrada.error }),
        ...(entrada.datos && { datos: entrada.datos }),
    };
    if (entrada.nivel === 'error') {
        console.error(JSON.stringify(registro));
    }
    else {
        console.log(JSON.stringify(registro));
    }
}
function logInfo(evento, datos) {
    log({ nivel: 'info', evento, ...datos });
}
function logError(evento, error, datos) {
    log({ nivel: 'error', evento, error, ...datos });
}
function logWarn(evento, datos) {
    log({ nivel: 'warn', evento, ...datos });
}
