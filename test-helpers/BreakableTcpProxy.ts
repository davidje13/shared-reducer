import { Socket, createServer, type Server } from 'node:net';

export class BreakableTcpProxy {
  private connected = true;
  private readonly socketCommands = new Set<SocketCommands>();
  public readonly server: Server;

  constructor(target: { address: string; port: number } | string | null) {
    if (!target || typeof target !== 'object') {
      throw new Error('Invalid target');
    }

    this.server = createServer((s1) => {
      if (!this.connected) {
        s1.destroy();
        return;
      }
      let sConnected = true;
      const s2 = new Socket();
      s2.connect(target.port, target.address);
      const sc1: SocketCommands = {
        end: () => {
          sConnected = false;
          s1.end();
          this.socketCommands.delete(sc1);
        },
        destroy: () => {
          sConnected = false;
        },
      };
      const sc2: SocketCommands = {
        end: () => {
          sConnected = false;
          s2.end();
          this.socketCommands.delete(sc2);
        },
        destroy: () => {
          sConnected = false;
        },
      };
      this.socketCommands.add(sc1);
      this.socketCommands.add(sc2);
      s1.on('data', (data) => {
        if (sConnected) {
          s2.write(data);
        } else {
          s1.destroy();
          this.socketCommands.delete(sc1);
        }
      });
      s2.on('data', (data) => {
        if (sConnected) {
          s1.write(data);
        } else {
          s2.destroy();
          this.socketCommands.delete(sc2);
        }
      });
      s1.once('close', () => {
        if (sConnected) {
          s2.end();
          this.socketCommands.delete(sc2);
        } else {
          s1.destroy();
          this.socketCommands.delete(sc1);
        }
      });
      s2.once('close', () => {
        if (sConnected) {
          s1.end();
          this.socketCommands.delete(sc1);
        } else {
          s2.destroy();
          this.socketCommands.delete(sc2);
        }
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
