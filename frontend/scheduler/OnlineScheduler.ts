import { makeTimeout } from '../helpers/timeout';
import type { ErrorHandler, Handler, Scheduler } from './Scheduler';

type DelayGetter = (attempt: number) => number;

export class OnlineScheduler implements Scheduler {
  private _timeout: NodeJS.Timeout | null = null;
  private _stop: (() => void) | null = null;
  private _handler: Handler | null = null;
  private _errorHandler: ErrorHandler = () => null;
  private _attempts = 0;

  public constructor(
    private readonly _delayGetter: DelayGetter,
    private readonly _connectTimeLimit: number,
  ) {
    this._attempt = this._attempt.bind(this);
  }

  public trigger(handler: Handler, errorHandler: ErrorHandler) {
    this.stop();
    this._handler = handler;
    this._errorHandler = errorHandler;
    this._attempt();
  }

  public schedule(handler: Handler, errorHandler: ErrorHandler) {
    if (this._handler === handler) {
      return;
    }
    if (this._stop) {
      this.stop();
    }
    this._handler = handler;
    this._errorHandler = errorHandler;
    if (this._timeout !== null) {
      return;
    }
    if (globalThis.document?.visibilityState === 'hidden') {
      globalThis.addEventListener?.('visibilitychange', this._attempt);
    } else {
      globalThis.addEventListener?.('online', this._attempt);
      this._timeout = setTimeout(this._attempt, this._delayGetter(this._attempts));
    }
    globalThis.addEventListener?.('pageshow', this._attempt);
    globalThis.addEventListener?.('focus', this._attempt);
    ++this._attempts;
  }

  public stop() {
    this._handler = null;
    this._stop?.();
    this._stop = null;
    this._remove();
  }

  private async _attempt() {
    if (this._stop || !this._handler) {
      return;
    }
    this._remove();
    const ac = new AbortController();
    const timeout = makeTimeout(this._connectTimeLimit);
    this._stop = () => {
      timeout.stop();
      ac.abort();
    };
    try {
      await Promise.race([this._handler(ac.signal), timeout.promise]);
      this._handler = null;
      this._attempts = 0;
    } catch (e) {
      if (!ac.signal.aborted) {
        ac.abort();
        try {
          this._errorHandler(e);
        } catch (e2) {
          console.error('Error handler failed', e, e2);
        }
        const h = this._handler;
        if (h) {
          this._handler = null;
          this.schedule(h, this._errorHandler);
        }
      }
    } finally {
      timeout.stop();
      this._stop = null;
    }
  }

  private _remove() {
    if (this._timeout === null) {
      return;
    }
    clearTimeout(this._timeout);
    this._timeout = null;
    globalThis.removeEventListener?.('online', this._attempt);
    globalThis.removeEventListener?.('pageshow', this._attempt);
    globalThis.removeEventListener?.('visibilitychange', this._attempt);
    globalThis.removeEventListener?.('focus', this._attempt);
  }
}

interface ExponentialDelayConfig {
  base?: number;
  initialDelay: number;
  maxDelay: number;
  randomness?: number;
}

export const exponentialDelay =
  ({ base = 2, initialDelay, maxDelay, randomness = 0 }: ExponentialDelayConfig): DelayGetter =>
  (attempt) =>
    Math.min(Math.pow(base, attempt) * initialDelay, maxDelay) * (1 - Math.random() * randomness);
