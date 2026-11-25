import { createServer, connect, type Server, type Socket } from 'node:net';

/**
 * Proxy TCP de pruebas entre el servicio y PostgreSQL. Permite simular, sin tocar el contenedor:
 * - `forward`: tráfico normal;
 * - `refuse`: la conexión se corta al aceptarla (base caída);
 * - `blackhole`: acepta y nunca responde (base colgada; prueba los límites de tiempo).
 * Registra los bytes cliente→servidor (sin TLS en local) para verificar qué envía la aplicación.
 */
export type ProxyMode = 'forward' | 'refuse' | 'blackhole';

export interface TcpProxy {
  readonly port: number;
  mode: ProxyMode;
  /** Bytes enviados por los clientes desde el último `resetCapture()`. */
  captured(): string;
  resetCapture(): void;
  /** Cierra todas las conexiones abiertas (simula un reinicio de la base). */
  dropConnections(): void;
  close(): Promise<void>;
}

export async function startTcpProxy(targetHost: string, targetPort: number): Promise<TcpProxy> {
  const sockets = new Set<Socket>();
  let capture: Buffer[] = [];
  const state = { mode: 'forward' as ProxyMode };

  const server: Server = createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => undefined);
    if (state.mode === 'refuse') return void client.destroy();
    if (state.mode === 'blackhole') return;
    const upstream = connect(targetPort, targetHost);
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => client.destroy());
    client.on('data', (chunk: Buffer) => capture.push(Buffer.from(chunk)));
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    port,
    get mode() {
      return state.mode;
    },
    set mode(value: ProxyMode) {
      state.mode = value;
    },
    captured: () => Buffer.concat(capture).toString('latin1'),
    resetCapture: () => void (capture = []),
    dropConnections: () => {
      for (const socket of sockets) socket.destroy();
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
