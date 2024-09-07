import { unpackMessage } from './Message';
import type { Broadcaster } from '../Broadcaster';
import type { Permission } from '../permission/Permission';

export const PING = 'P';
export const PONG = 'p';

type MaybePromise<T> = Promise<T> | T;

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
  ) =>
  async (req: Req, res: Res) => {
    const ws = await res.accept();

    try {
      const id = await idGetter(req, res);
      const permission = await permissionGetter(req, res);
      const subscription = await broadcaster.subscribe<number>(id, permission);

      if (!subscription) {
        res.sendError(404);
        return;
      }

      ws.on('close', subscription.close);

      ws.on('message', (data, isBinary) => {
        try {
          if (isBinary) {
            return; // ignore
          }

          const msg = String(data);
          if (msg === PING) {
            ws.send(PONG);
            return;
          }

          const request = unpackMessage(msg);

          res.beginTransaction();
          subscription
            .send(request.change as SpecT, request.id)
            .finally(() => res.endTransaction());
        } catch (e) {
          ws.send(JSON.stringify(convertError(e)));
        }
      });

      ws.send(JSON.stringify({ init: subscription.getInitialData() }));
      subscription.listen((msg, id) => {
        const data = id !== undefined ? { id, ...msg } : msg;
        ws.send(JSON.stringify(data));
      });
    } catch (e) {
      ws.send(JSON.stringify(convertError(e)));
    }
  };

function convertError(e: unknown) {
  return { error: e instanceof Error ? e.message : 'Internal error' };
}
