import { Response } from 'express';

const clientes: Map<string, Response> = new Map();

export function agregarCliente(id: string, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('data: {"tipo":"conectado"}\n\n');
  clientes.set(id, res);
  res.on('close', () => { clientes.delete(id); });
}

export function emitirEvento(evento: string, datos: any): void {
  const msg = `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
  clientes.forEach(res => { try { res.write(msg); } catch {} });
}
