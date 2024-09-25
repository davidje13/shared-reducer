import type { MaybePromise } from '../helpers/MaybePromise';
import { makeEvent, TypedEventTarget } from '../helpers/TypedEventTarget';
import type { Scheduler } from '../scheduler/Scheduler';

type ReconnectingWebSocketEvents = {
  connected: CustomEvent<void>;
  disconnected: CustomEvent<DisconnectDetail>;
  connectionfailure: CustomEvent<Error>;
  message: CustomEvent<string>;
};

export class ReconnectingWebSocket extends TypedEventTarget<ReconnectingWebSocketEvents> {
  private _ws: WebSocket | null = null;
  private _closed = false;

  public constructor(
    private readonly _connectionGetter: ConnectionGetter,
    private readonly _reconnectScheduler: Scheduler,
  ) {
    super();
    this._reconnect = this._reconnect.bind(this);
    this._handleError = this._handleError.bind(this);
    this._reconnectScheduler.trigger(this._reconnect, this._handleError);
  }

  private _handleError(e: unknown) {
    const err = e instanceof Error ? e : new Error(`unknown connection error ${e}`);
    this.dispatchEvent(makeEvent('connectionfailure', err));
  }

  private async _reconnect(s: AbortSignal) {
    const { url, token } = await this._connectionGetter(s);
    if (s.aborted) {
      // AbortSignal.throwIfAborted is not currently supported in JSDOM
      throw s.reason;
    }

    const connectionAC = new AbortController();
    const connectionSignal = connectionAC.signal;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);

      let connecting = true;
      const handleClose = (detail: DisconnectDetail) => {
        connectionAC.abort();
        ws.close();
        if (connecting) {
          connecting = false;
          reject(new Error(`Connection closed ${detail.code} ${detail.reason}`));
        } else {
          this._ws = null;
          this.dispatchEvent(makeEvent('disconnected', detail));
          if (!this._closed) {
            this._reconnectScheduler.schedule(this._reconnect, this._handleError);
          }
        }
      };

      if (token) {
        ws.addEventListener('open', () => ws.send(token), { once: true, signal: connectionSignal });
      }

      ws.addEventListener(
        'message',
        (e) => {
          if (e.data === PONG) {
            return;
          }
          if (connecting) {
            connecting = false;
            this._ws = ws;
            this.dispatchEvent(makeEvent('connected'));
            resolve();
          }
          this.dispatchEvent(makeEvent('message', e.data));
        },
        { signal: connectionSignal },
      );

      ws.addEventListener('close', handleClose, { signal: connectionSignal });
      ws.addEventListener('error', () => handleClose(ERROR_DETAIL), { signal: connectionSignal });
      s.addEventListener(
        'abort',
        () => () => {
          connectionAC.abort();
          ws.close();
          connecting = false;
          reject(s.reason);
        },
        { signal: connectionSignal },
      );

      schedulePings(ws);
    }).catch((e: unknown) => {
      connectionAC.abort();
      throw e;
    });
  }

  public isConnected() {
    return this._ws !== null;
  }

  public readonly send = (message: string) => {
    if (!this._ws) {
      throw new Error('connection lost');
    }
    this._ws.send(message);
  };

  public close() {
    this._closed = true;
    this._reconnectScheduler.stop();
    this._ws?.close();
  }
}

function schedulePings(ws: WebSocket) {
  const ac = new AbortController();
  let timeout: NodeJS.Timeout | null = null;

  const ping = () => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    ws.send(PING);
    // server will send a PONG, which will schedule the next ping
  };
  const schedule = () => {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(ping, PING_INTERVAL);
  };
  const stop = () => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    ac.abort();
  };
  ws.addEventListener('open', schedule, { once: true, signal: ac.signal });
  ws.addEventListener('message', schedule, { signal: ac.signal });
  ws.addEventListener('close', stop, { signal: ac.signal });
  ws.addEventListener('error', stop, { signal: ac.signal });
  globalThis.addEventListener?.('offline', ping, { signal: ac.signal });
}

export interface ConnectionInfo {
  url: string;
  token?: string | undefined;
}

export type ConnectionGetter = (signal: AbortSignal) => MaybePromise<ConnectionInfo>;

export interface DisconnectDetail {
  code: number;
  reason: string;
}

const ERROR_DETAIL: DisconnectDetail = { code: 0, reason: 'client side error' };

const PING = 'P';
const PONG = 'p';
const PING_INTERVAL = 20 * 1000;
