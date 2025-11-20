import type { Broadcaster } from '../Broadcaster';
import { PermissionError, type Permission } from '../permission/Permission';
import type { MaybePromise } from '../helpers/MaybePromise';
import { MessageParseError, unpackMessage } from './Message';

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
  close(): void;
  terminate(): void;
}

interface Access<T, SpecT> {
  id: string;
  permission: Permission<T, SpecT>;
}

type First<T extends any[]> = T extends [infer F, ...any[]] ? F : never;

interface WebsocketHandlerCoreOptions<AccessGetter, AcceptWebSocket> {
  accessGetter: AccessGetter;
  acceptWebSocket: AcceptWebSocket;
}

export interface WebsocketHandlerOptions<Arg0> {
  pingInterval?: number;
  pongTimeout?: number;
  notFoundError?: Error;
  setSoftCloseHandler?: (arg0: Arg0, handler: () => Promise<void>) => void;
  onConnect?: (arg0: Arg0) => void;
  onDisconnect?: (arg0: Arg0, reason: string, connectionDuration: number) => void;
  onError?: (arg0: Arg0, error: unknown, context: string) => void;
}

export class WebsocketHandlerFactory<T, SpecT> {
  constructor(private readonly broadcaster: Broadcaster<T, SpecT>) {}

  public handler<
    Args extends any[],
    AccessGetter extends (...args: Args) => MaybePromise<Access<T, SpecT>>,
    AcceptWebSocket extends (...args: Args) => MaybePromise<ServerWebSocket>,
  >({
    accessGetter,
    acceptWebSocket,
    pingInterval = 25_000,
    pongTimeout = 30_000,
    notFoundError = NOT_FOUND_ERROR,
    setSoftCloseHandler,
    onConnect,
    onDisconnect,
    onError = DEFAULT_ERROR_HANDLER,
  }: WebsocketHandlerCoreOptions<AccessGetter, AcceptWebSocket> &
    WebsocketHandlerOptions<First<Args>>) {
    return async (...args: Args) => {
      const teardowns: (() => MaybePromise<void>)[] = [];
      let pingTm: NodeJS.Timeout | undefined;
      try {
        const { id, permission } = await accessGetter(...args);
        const subscription = await this.broadcaster.subscribe<number>(id, permission);
        if (!subscription) {
          throw notFoundError;
        }
        teardowns.push(() => subscription.close());

        let state = STATE_CONNECTED;
        let closeReason = 'connection failed';
        let closed: (reason: string) => void;
        const closePromise = new Promise<void>((resolve) => {
          closed = (reason) => {
            closed = () => {};
            closeReason = reason;
            resolve();
          };
        });

        const ws = await acceptWebSocket(...args);
        args.length = 1; // GC
        setSoftCloseHandler?.(args[0], () => {
          if (state === STATE_CONNECTED) {
            state = STATE_SOFT_CLOSING;
            ws.send(CLOSE);
            if (!pingTm) {
              pingTm = setTimeout(connectionLost, pongTimeout);
            }
          }
          return closePromise;
        });
        const begin = Date.now();
        onConnect?.(args[0]);
        teardowns.push(() => onDisconnect?.(args[0], closeReason, Date.now() - begin));

        ws.on('close', () => {
          clearTimeout(pingTm);
          state = STATE_CLOSED;
          closed('client disconnect');
        });

        const connectionLost = () => {
          ws.terminate();
          state = STATE_LOST;
          closed('connection lost');
        };

        const ping = () => {
          ws.ping();
          clearTimeout(pingTm);
          pingTm = setTimeout(connectionLost, pongTimeout);
        };

        const resetPing = () => {
          clearTimeout(pingTm);
          pingTm = setTimeout(ping, pingInterval);
        };

        ws.on('pong', resetPing);

        ws.on('message', async (data, isBinary) => {
          resetPing();
          if (isBinary) {
            return ws.send(JSON.stringify({ error: 'Binary messages are not supported' }));
          }

          const msg = String(data);
          if (msg === PING) {
            return ws.send(PONG);
          }
          if (msg === CLOSE_ACK) {
            if (state !== STATE_SOFT_CLOSING && state !== STATE_LOST) {
              return ws.send(JSON.stringify({ error: 'Unexpected close ack message' }));
            }
            state = STATE_CLOSED;
            closed('clean shutdown');
            return ws.close();
          }
          if (state === STATE_CLOSED) {
            return ws.send(JSON.stringify({ error: 'Unexpected message after close ack' }));
          }

          try {
            const request = unpackMessage(msg);
            await subscription.send(request.change as SpecT, request.id);
          } catch (error) {
            if (error instanceof PermissionError || error instanceof MessageParseError) {
              ws.send(JSON.stringify({ error: error.message }));
            } else {
              onError(args[0], error, 'message');
              ws.send(JSON.stringify({ error: 'Internal error' }));
            }
          }
        });

        if (state === STATE_CONNECTED) {
          ws.send(JSON.stringify({ init: subscription.getInitialData() }));
          subscription.listen((msg, id) =>
            ws.send(JSON.stringify(id !== undefined ? { id, ...msg } : msg)),
          );
          resetPing();
        }
        await closePromise;
      } finally {
        clearTimeout(pingTm);
        for (const fn of teardowns.reverse()) {
          try {
            await fn();
          } catch (error) {
            onError(args[0], error, 'teardown');
          }
        }
      }
    };
  }
}

const STATE_CONNECTED = 0;
const STATE_SOFT_CLOSING = 1;
const STATE_CLOSED = 2;
const STATE_LOST = 3;

const NOT_FOUND_ERROR = new Error('not found');

const DEFAULT_ERROR_HANDLER = (_: unknown, error: unknown, context: string) =>
  console.warn(`shared-reducer: ${context}`, error);
