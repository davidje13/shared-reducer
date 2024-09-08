import type { MaybePromise } from './helpers/MaybePromise';

const PING = 'P';
const PONG = 'p';
const PING_INTERVAL = 20 * 1000;

const exponentialReconnectDelay =
  (base: number, initialDelay: number, maxDelay: number, randomness: number) =>
  (attempt: number) => {
    return (
      Math.min(Math.pow(base, attempt) * initialDelay, maxDelay) * (1 - Math.random() * randomness)
    );
  };

interface DisconnectDetail {
  code: number;
  reason: string;
}

export class ReconnectingWebSocket extends EventTarget {
  private _ws: WebSocket | null = null;
  private _closed = false;
  private _connecting = false;
  private _reconnectTimeout: NodeJS.Timeout | null = null;
  private _connectionAttempts = 0;

  public constructor(
    private readonly _connectionGetter: () => MaybePromise<{ url: string; token?: string }>,
    private readonly _reconnectDelay = exponentialReconnectDelay(2, 200, 600_000, 0.3),
  ) {
    super();
    this._reconnect();
  }

  private readonly _reconnect = async () => {
    this._cancelReconnect();
    if (this._ws || this._connecting || this._closed) {
      return;
    }
    this._connecting = true;
    const ac = new AbortController();
    try {
      const { url, token } = await this._connectionGetter();
      const ws = new WebSocket(url);
      if (token) {
        ws.addEventListener('open', () => ws.send(token), { once: true, signal: ac.signal });
      }

      const handshakeTimeout = setTimeout(
        () => handleClose({ code: 0, reason: 'handshake timeout' }),
        20000,
      );

      ws.addEventListener(
        'message',
        (e) => {
          if (e.data === PONG) {
            return;
          }
          if (this._connecting) {
            clearTimeout(handshakeTimeout);
            this._ws = ws;
            this._connecting = false;
            this._connectionAttempts = 0;
            this.dispatchEvent(new CustomEvent('connected'));
          }
          this.dispatchEvent(new CustomEvent('message', { detail: e.data }));
        },
        { signal: ac.signal },
      );

      const handleClose = (detail: DisconnectDetail) => {
        ac.abort();
        clearTimeout(handshakeTimeout);
        this._connecting = false;
        if (this._ws) {
          this._ws = null;
          this.dispatchEvent(new CustomEvent('disconnected', { detail }));
        }
        this._scheduleReconnect();
      };

      ws.addEventListener('close', (e) => handleClose({ code: e.code, reason: e.reason }), {
        signal: ac.signal,
      });

      ws.addEventListener('error', () => handleClose({ code: 0, reason: 'client side error' }), {
        signal: ac.signal,
      });

      schedulePings(ws);
    } catch (e) {
      ac.abort();
      this._ws = null;
      this._connecting = false;
      this._scheduleReconnect();
    }
  };

  private _scheduleReconnect() {
    if (this._ws || this._connecting || this._closed || this._reconnectTimeout !== null) {
      return;
    }
    const delay = this._reconnectDelay(this._connectionAttempts);
    this._reconnectTimeout = setTimeout(this._reconnect, delay);
    global.addEventListener?.('online', this._reconnect);
    global.addEventListener?.('pageshow', this._reconnect);
    global.addEventListener?.('focus', this._reconnect);
    ++this._connectionAttempts;
  }

  private _cancelReconnect() {
    if (this._reconnectTimeout !== null) {
      clearTimeout(this._reconnectTimeout);
      global.removeEventListener?.('online', this._reconnect);
      global.removeEventListener?.('pageshow', this._reconnect);
      global.removeEventListener?.('focus', this._reconnect);
      this._reconnectTimeout = null;
    }
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
    this._cancelReconnect();
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
