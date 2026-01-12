import { makeEvent, TypedEventTarget } from '../helpers/TypedEventTarget';
import type { Scheduler } from '../scheduler/Scheduler';

type ReconnectingWebSocketEvents = {
  connected: CustomEvent<void>;
  disconnected: CustomEvent<DisconnectDetail>;
  rejected: CustomEvent<DisconnectDetail>;
  connectionfailure: CustomEvent<Error>;
  message: CustomEvent<string>;
};

export class ReconnectingWebSocket extends TypedEventTarget<ReconnectingWebSocketEvents> {
  private _ws: WebSocket | null = null;
  private _closed = false;

  public constructor(
    private _connectionInfo: ConnectionInfo,
    private readonly _reconnectScheduler: Scheduler,
  ) {
    super();
    this._reconnect = this._reconnect.bind(this);
    this._handleError = this._handleError.bind(this);
    this._reconnectScheduler.trigger(this._reconnect, this._handleError);
  }

  reconnect(connectionInfo?: ConnectionInfo) {
    if (connectionInfo) {
      this._connectionInfo = connectionInfo;
    }
    if (this._ws) {
      this._ws.close();
    } else if (!this._closed) {
      this._reconnectScheduler.schedule(this._reconnect, this._handleError);
    }
  }

  private _handleError(e: unknown) {
    const err = e instanceof Error ? e : new Error(`unknown connection error ${e}`);
    this.dispatchEvent(makeEvent('connectionfailure', { detail: err }));
  }

  private async _reconnect(signal: AbortSignal) {
    signal.throwIfAborted();

    const connectionAC = new AbortController();
    const connectionSignal = connectionAC.signal;
    const { url, token } = this._connectionInfo;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);

      let connecting = true;
      const handleClose = (detail: DisconnectDetail) => {
        connectionAC.abort();
        ws.close();
        const wasConnecting = connecting;
        connecting = false;
        if (!wasConnecting) {
          this._ws = null;
          this.dispatchEvent(makeEvent('disconnected', { detail }));
        }
        if (
          !this._closed &&
          !this.dispatchEvent(makeEvent('rejected', { detail, cancelable: true }))
        ) {
          if (wasConnecting) {
            resolve();
          }
        } else if (wasConnecting) {
          reject(new Error(`Connection closed ${detail.code} ${detail.reason}`));
        } else if (!this._closed) {
          this._reconnectScheduler.schedule(this._reconnect, this._handleError);
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
          this.dispatchEvent(makeEvent('message', { detail: e.data }));
        },
        { signal: connectionSignal },
      );

      ws.addEventListener('close', handleClose, { signal: connectionSignal });
      ws.addEventListener(
        'error',
        (e) => {
          let err = 'unknown';
          if ('error' in e) {
            const error = e.error;
            err = error instanceof Error ? (error.stack ?? String(error)) : String(error);
          }
          handleClose({
            code: 0,
            reason: `client side error: ${err}`,
          });
        },
        { signal: connectionSignal },
      );
      signal.addEventListener(
        'abort',
        () => {
          connectionAC.abort();
          ws.close();
          connecting = false;
          reject(signal.reason);
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

export interface DisconnectDetail {
  code: number;
  reason: string;
}

const PING = 'P';
const PONG = 'p';
const PING_INTERVAL = 20 * 1000;
