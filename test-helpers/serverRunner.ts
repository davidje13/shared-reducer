import type { Application } from 'express';
import type { Server } from 'http';

export function runLocalServer(app: Application): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, 'localhost', () => {
      resolve(server);
    });
  });
}

export function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) =>
    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    }),
  );
}

export function getAddress(server: Server, protocol = 'http'): string {
  const addr = server.address();
  if (!addr) {
    throw new Error('server not started');
  }
  if (typeof addr === 'string') {
    return addr;
  }
  const { address, family, port } = addr;
  const host = family === 'IPv6' ? `[${address}]` : address;
  return `${protocol}://${host}:${port}`;
}
