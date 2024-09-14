import type { MaybePromise } from './helpers/MaybePromise';
import { ReconnectScheduler } from './reconnection/ReconnectScheduler';

export class ReconnectingWebSocket extends EventTarget {
  private _ws: WebSocket | null = null;
  private _closed = false;
  private readonly _reconnectScheduler: Scheduler;

  public constructor(
    private readonly _connectionGetter: () => MaybePromise<{ url: string; token?: string }>,
    reconnectSchedulerFactory = (fn: (signal: AbortSignal) => MaybePromise<void>): Scheduler =>
      new ReconnectScheduler(fn, 20_000),
  ) {
    super();
    this._reconnectScheduler = reconnectSchedulerFactory(this._reconnect.bind(this));
    this._reconnectScheduler.trigger();
  }

  private async _reconnect(s: AbortSignal) {
    const { url, token } = await this._connectionGetter();
    s.throwIfAborted();

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
          reject(new Error(`handshake failed: ${detail.code} ${detail.reason}`));
        } else {
          this._ws = null;
          this.dispatchEvent(new CustomEvent('disconnected', { detail }));
          if (!this._closed) {
            this._reconnectScheduler.schedule();
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
            this.dispatchEvent(new CustomEvent('connected'));
            resolve();
          }
          this.dispatchEvent(new CustomEvent('message', { detail: e.data }));
        },
        { signal: connectionSignal },
      );

      ws.addEventListener('close', handleClose, { signal: connectionSignal });
      ws.addEventListener('error', () => handleClose(ERROR_DETAIL), { signal: connectionSignal });
      s.addEventListener('abort', () => handleClose(ABORT_DETAIL), { signal: connectionSignal });

      schedulePings(ws);
    }).catch((e) => {
      connectionAC.abort();
      throw e;
    });
  }

  public isConnected() {
    return this._ws !== null;
  }

  public send(message: string) {
    if (!this._ws) {
      throw new Error('connection lost');
    }
    this._ws.send(message);
  }

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
  global.addEventListener?.('offline', ping, { signal: ac.signal });
}

interface DisconnectDetail {
  code: number;
  reason: string;
}

interface Scheduler {
  trigger(): void;
  schedule(): void;
  stop(): void;
}

const ERROR_DETAIL: DisconnectDetail = { code: 0, reason: 'client side error' };
const ABORT_DETAIL: DisconnectDetail = { code: 0, reason: 'handshake timeout' };

const PING = 'P';
const PONG = 'p';
const PING_INTERVAL = 20 * 1000;
