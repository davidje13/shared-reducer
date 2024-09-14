import type { MaybePromise } from '../helpers/MaybePromise';

export class ReconnectScheduler {
  private _timeout: NodeJS.Timeout | null = null;
  private _stop: (() => void) | null = null;
  private _running = false;
  private _attempts = 0;

  public constructor(
    private readonly _handler: (signal: AbortSignal) => MaybePromise<void>,
    private readonly _connectTimeLimit: number,
    private readonly _reconnectDelay = exponentialDelay(2, 200, 600_000, 0.3),
  ) {
    this._attempt = this._attempt.bind(this);
  }

  public async trigger() {
    this.stop();
    this._running = true;
    this._attempt();
  }

  schedule() {
    if (this._timeout !== null || this._stop !== null) {
      return;
    }
    this._running = true;
    if (global.document?.visibilityState === 'hidden') {
      global.addEventListener?.('visibilitychange', this._attempt);
    } else {
      global.addEventListener?.('online', this._attempt);
      this._timeout = setTimeout(this._attempt, this._reconnectDelay(this._attempts));
    }
    global.addEventListener?.('pageshow', this._attempt);
    global.addEventListener?.('focus', this._attempt);
    ++this._attempts;
  }

  stop() {
    this._running = false;
    this._stop?.();
    this._stop = null;
    this._remove();
  }

  private async _attempt() {
    if (this._stop) {
      return;
    }
    this._remove();
    const ac = new AbortController();
    let stopTimeout: () => void = () => null;
    this._stop = () => {
      stopTimeout();
      ac.abort();
    };
    try {
      await Promise.race([
        this._handler(ac.signal),
        new Promise((_, reject) => {
          const connectTimeout = setTimeout(reject, this._connectTimeLimit);
          stopTimeout = () => clearTimeout(connectTimeout);
        }),
      ]);
      this._attempts = 0;
    } catch (_ignore) {
      if (!ac.signal.aborted) {
        ac.abort();
        if (this._running) {
          this.schedule();
        }
      }
    } finally {
      stopTimeout();
      this._stop = null;
    }
  }

  private _remove() {
    if (this._timeout === null) {
      return;
    }
    clearTimeout(this._timeout);
    this._timeout = null;
    global.removeEventListener?.('online', this._attempt);
    global.removeEventListener?.('pageshow', this._attempt);
    global.removeEventListener?.('visibilitychange', this._attempt);
    global.removeEventListener?.('focus', this._attempt);
  }
}

const exponentialDelay =
  (base: number, initialDelay: number, maxDelay: number, randomness: number) => (attempt: number) =>
    Math.min(Math.pow(base, attempt) * initialDelay, maxDelay) * (1 - Math.random() * randomness);
