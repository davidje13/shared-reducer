import { unpackMessage } from './Message';
import type { Broadcaster } from '../Broadcaster';
import type { Permission } from '../permission/Permission';
import type { MaybePromise } from '../helpers/MaybePromise';

export const PING = 'P';
export const PONG = 'p';

interface ServerWebSocket {
  on(event: 'close', listener: () => void): void;
  on(event: 'message', listener: (data: unknown, isBinary?: boolean) => void): void;
  send(message: string): void;
}

interface WSResponse {
  accept(): Promise<ServerWebSocket>;
  sendError(httpStatus: number): void;
  beginTransaction(): void;
  endTransaction(): void;
}

export const websocketHandler =
  <T, SpecT>(broadcaster: Broadcaster<T, SpecT>) =>
  <Req, Res extends WSResponse>(
    idGetter: (req: Req, res: Res) => MaybePromise<string>,
    permissionGetter: (req: Req, res: Res) => MaybePromise<Permission<T, SpecT>>,
  ) => {
    const handshake = async (req: Req, res: Res) => {
      const id = await idGetter(req, res);
      const permission = await permissionGetter(req, res);
      const subscription = await broadcaster.subscribe<number>(id, permission);
      if (!subscription) {
        res.sendError(404);
        return null;
      }
      return subscription;
    };

    return async (req: Req, res: Res) => {
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

        ws.on('close', () => subscription.close().catch(() => null));

        ws.on('message', async (data, isBinary) => {
          try {
            if (isBinary) {
              throw new Error('Binary messages are not supported');
            }

            const msg = String(data);
            if (msg === PING) {
              ws.send(PONG);
              return;
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

        ws.send(JSON.stringify({ init: subscription.getInitialData() }));
        subscription.listen((msg, id) => {
          const data = id !== undefined ? { id, ...msg } : msg;
          ws.send(JSON.stringify(data));
        });
      } catch (e) {
        console.warn('WebSocket error', e);
        res.sendError(500);
        subscription.close().catch(() => null);
      }
    };
  };
