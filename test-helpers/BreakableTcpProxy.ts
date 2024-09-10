import { Socket, createServer, type Server } from 'node:net';

export class BreakableTcpProxy {
  private connected = true;
  private readonly socketCommands = new Set<SocketCommands>();
  public readonly server: Server;

  constructor(target: { address: string; port: number } | string | null) {
    if (!target || typeof target !== 'object') {
      throw new Error('Invalid target');
    }

    this.server = createServer((s) => {
      if (!this.connected) {
        s.destroy();
        return;
      }
      let sConnected = true;
      const s2 = new Socket();
      s2.connect(target.port, target.address);
      const sc: SocketCommands = {
        end: () => {
          sConnected = false;
          s.end();
          s2.end();
        },
        destroy: () => {
          sConnected = false;
          s.destroy();
          s2.destroy();
        },
      };
      this.socketCommands.add(sc);
      s.on('data', (data) => sConnected && s2.write(data, () => null));
      s2.on('data', (data) => sConnected && s.write(data, () => null));
      s.once('close', () => {
        s2.end();
        this.socketCommands.delete(sc);
      });
      s2.once('close', () => {
        s.end();
        this.socketCommands.delete(sc);
      });
    });
  }

  listen(port: number, hostname: string) {
    return new Promise<void>((resolve) => this.server.listen(port, hostname, resolve));
  }

  pullWire() {
    this.connected = false;
    this.socketCommands.forEach((c) => c.destroy());
  }

  cleanTcpClose() {
    this.connected = false;
    this.socketCommands.forEach((c) => c.end());
  }

  stopNewConnections() {
    this.connected = false;
  }

  resume() {
    this.connected = true;
  }

  close() {
    this.connected = false;
    this.socketCommands.forEach((c) => c.end());
    return new Promise((resolve) => this.server.close(resolve));
  }
}

interface SocketCommands {
  end(): void;
  destroy(): void;
}
