import { unpackMessage } from './Message';
import type { Broadcaster } from '../Broadcaster';
import type { Permission } from '../permission/Permission';
import type { MaybePromise } from '../helpers/MaybePromise';

export const PING = 'P';
export const PONG = 'p';
export const CLOSE = 'X';
export const CLOSE_ACK = 'x';

interface ServerWebSocket {
  on(event: 'close', listener: () => void): void;
  on(event: 'message', listener: (data: unknown, isBinary?: boolean) => void): void;
  on(event: 'pong', listener: () => void): void;
  ping(): void;
  send(message: string): void;
  terminate(): void;
}

interface WSResponse {
  accept(): Promise<ServerWebSocket>;
  sendError(httpStatus: number, wsStatus?: number): void;
  beginTransaction(): void;
  endTransaction(): void;
}

export interface WebsocketHandlerOptions {
  pingInterval?: number;
  pongTimeout?: number;
}

export class WebsocketHandlerFactory<T, SpecT> {
  private readonly closers = new Set<() => Promise<void>>();
  private readonly _pingInterval: number;
  private readonly _pongTimeout: number;
  private closing = false;

  constructor(
    private readonly broadcaster: Broadcaster<T, SpecT>,
    options: WebsocketHandlerOptions = {},
  ) {
    this._pingInterval = options.pingInterval ?? 25_000;
    this._pongTimeout = options.pongTimeout ?? 30_000;
  }

  public activeConnections() {
    return this.closers.size;
  }

  public async softClose(timeout: number) {
    this.closing = true;
    let tm: NodeJS.Timeout | null = null;
    await Promise.race([
      Promise.all([...this.closers].map((c) => c())),
      new Promise((resolve) => {
        tm = setTimeout(resolve, timeout);
      }),
    ]);
    if (tm !== null) {
      clearTimeout(tm);
    }
  }

  public handler<Req, Res extends WSResponse>(
    idGetter: (req: Req, res: Res) => MaybePromise<string>,
    permissionGetter: (req: Req, res: Res) => MaybePromise<Permission<T, SpecT>>,
  ) {
    const handshake = async (req: Req, res: Res) => {
      const id = await idGetter(req, res);
      const permission = await permissionGetter(req, res);
      const subscription = await this.broadcaster.subscribe<number>(id, permission);
      if (!subscription) {
        res.sendError(404);
        return null;
      }
      return subscription;
    };

    return async (req: Req, res: Res) => {
      if (this.closing) {
        res.sendError(503, 1012);
        return;
      }
      const subscription = await handshake(req, res).catch((e) => {
        console.warn('WebSocket init error', e);
        res.sendError(500);
        return null;
      });
      if (!subscription) {
        return;
      }

      try {
        const ws = await res.accept();
        let state = 0;

        let closed: () => void = () => null;
        const handleSoftClose = () => {
          this.closers.delete(handleSoftClose);
          ws.send(CLOSE);
          state = 1;
          return new Promise<void>((resolve) => {
            closed = resolve;
          });
        };

        ws.on('close', () => {
          state = 2;
          clearTimeout(pingTm);
          subscription.close().catch(() => null);
          this.closers.delete(handleSoftClose);
          closed();
        });

        const connectionLost = () => {
          subscription.close().catch(() => null);
          this.closers.delete(handleSoftClose);
          ws.terminate();
          closed();
        };

        const ping = () => {
          ws.ping();
          clearTimeout(pingTm);
          pingTm = setTimeout(connectionLost, this._pongTimeout);
        };

        ws.on('pong', () => {
          clearTimeout(pingTm);
          pingTm = setTimeout(ping, this._pingInterval);
        });

        ws.on('message', async (data, isBinary) => {
          clearTimeout(pingTm);
          pingTm = setTimeout(ping, this._pingInterval);
          try {
            if (isBinary) {
              throw new Error('Binary messages are not supported');
            }

            const msg = String(data);
            if (msg === PING) {
              ws.send(PONG);
              return;
            }
            if (msg === CLOSE_ACK) {
              if (state !== 1) {
                throw new Error('Unexpected close ack message');
              }
              state = 2;
              closed();
              return;
            }
            if (state === 2) {
              throw new Error('Unexpected message after close ack');
            }

            const request = unpackMessage(msg);

            res.beginTransaction();
            try {
              await subscription.send(request.change as SpecT, request.id);
            } finally {
              res.endTransaction();
            }
          } catch (e) {
            ws.send(
              JSON.stringify({
                error: e instanceof Error ? e.message : 'Internal error',
              }),
            );
          }
        });

        if (this.closing) {
          res.sendError(503, 1012);
          subscription.close().catch(() => null);
          return;
        }
        ws.send(JSON.stringify({ init: subscription.getInitialData() }));
        subscription.listen((msg, id) => {
          const data = id !== undefined ? { id, ...msg } : msg;
          ws.send(JSON.stringify(data));
        });
        let pingTm = setTimeout(ping, this._pingInterval);
        this.closers.add(handleSoftClose);
      } catch (e) {
        console.warn('WebSocket error', e);
        res.sendError(500);
        subscription.close().catch(() => null);
      }
    };
  }
}
