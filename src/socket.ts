import { Server as SocketIO } from 'socket.io';
import { logInfo } from './modules/logger';

let _io: SocketIO | null = null;

export function initSocket(server: any): SocketIO {
  _io = new SocketIO(server, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling']
  });
  _io.on('connection', (socket) => {
    logInfo('WS_CONNECTED', { mensaje: `Cliente conectado: ${socket.id}` });
    socket.on('disconnect', () => {
      logInfo('WS_DISCONNECTED', { mensaje: `Cliente desconectado: ${socket.id}` });
    });
  });
  return _io;
}

export function getIO(): SocketIO {
  if (!_io) throw new Error('Socket.io no inicializado');
  return _io;
}
