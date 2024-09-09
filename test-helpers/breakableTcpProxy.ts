import { Socket, createServer } from 'node:net';

export async function makeBreakableTcpProxy(
  target: { address: string; port: number } | string | null,
) {
  if (!target || typeof target !== 'object') {
    throw new Error('Invalid target');
  }

  let connected = true;
  const open = new Set<Socket>();
  const server = createServer((s) => {
    if (!connected) {
      s.destroy();
      return;
    }
    const s2 = new Socket();
    s2.connect(target.port, target.address);
    open.add(s);
    open.add(s2);
    s.on('data', (data) => connected && s2.write(data, () => null));
    s2.on('data', (data) => connected && s.write(data, () => null));
    s.once('close', () => {
      open.delete(s);
      if (connected) {
        s2.end();
        open.delete(s2);
      }
    });
    s2.once('close', () => {
      open.delete(s2);
      if (connected) {
        open.delete(s);
        s.end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));

  return {
    server,
    setConnected(c: boolean) {
      connected = c;
      if (!c) {
        open.forEach((s) => s.destroy());
      }
    },
    close() {
      connected = false;
      open.forEach((s) => s.end());
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
