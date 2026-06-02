"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocket = initSocket;
exports.getIO = getIO;
const socket_io_1 = require("socket.io");
const logger_1 = require("./modules/logger");
let _io = null;
function initSocket(server) {
    _io = new socket_io_1.Server(server, {
        cors: { origin: '*' },
        transports: ['websocket', 'polling']
    });
    _io.on('connection', (socket) => {
        (0, logger_1.logInfo)('WS_CONNECTED', { mensaje: `Cliente conectado: ${socket.id}` });
        socket.on('disconnect', () => {
            (0, logger_1.logInfo)('WS_DISCONNECTED', { mensaje: `Cliente desconectado: ${socket.id}` });
        });
    });
    return _io;
}
function getIO() {
    if (!_io)
        throw new Error('Socket.io no inicializado');
    return _io;
}
