type Nivel = 'info' | 'error' | 'warn' | 'debug';

interface EntradaLog {
  nivel?: Nivel;
  evento: string;
  mensaje?: string;
  usuario?: string;
  pc?: string;
  endpoint?: string;
  error?: string;
  datos?: Record<string, any>;
}

function log(entrada: EntradaLog): void {
  const registro = {
    timestamp: new Date().toISOString(),
    nivel: entrada.nivel || 'info',
    evento: entrada.evento,
    ...(entrada.mensaje  && { mensaje:  entrada.mensaje }),
    ...(entrada.usuario  && { usuario:  entrada.usuario }),
    ...(entrada.pc       && { pc:       entrada.pc }),
    ...(entrada.endpoint && { endpoint: entrada.endpoint }),
    ...(entrada.error    && { error:    entrada.error }),
    ...(entrada.datos    && { datos:    entrada.datos }),
  };

  if (entrada.nivel === 'error') {
    console.error(JSON.stringify(registro));
  } else {
    console.log(JSON.stringify(registro));
  }
}

function logInfo(evento: string, datos?: Partial<EntradaLog>): void {
  log({ nivel: 'info', evento, ...datos });
}

function logError(evento: string, error: string, datos?: Partial<EntradaLog>): void {
  log({ nivel: 'error', evento, error, ...datos });
}

function logWarn(evento: string, datos?: Partial<EntradaLog>): void {
  log({ nivel: 'warn', evento, ...datos });
}

export { log, logInfo, logError, logWarn };
