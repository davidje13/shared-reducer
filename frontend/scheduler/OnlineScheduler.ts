import type { MaybePromise } from '../helpers/MaybePromise';
import type { Scheduler } from './Scheduler';

type Handler = (signal: AbortSignal) => MaybePromise<void>;
type DelayGetter = (attempt: number) => number;

export class OnlineScheduler implements Scheduler {
  private _timeout: NodeJS.Timeout | null = null;
  private _stop: (() => void) | null = null;
  private _handler: Handler | null = null;
  private _attempts = 0;

  public constructor(
    private readonly _delayGetter: DelayGetter,
    private readonly _connectTimeLimit: number,
  ) {
    this._attempt = this._attempt.bind(this);
  }

  public trigger(handler: Handler) {
    this.stop();
    this._handler = handler;
    this._attempt();
  }

  public schedule(handler: Handler) {
    if (this._handler === handler) {
      return;
    }
    if (this._stop) {
      this.stop();
    }
    this._handler = handler;
    if (this._timeout !== null) {
      return;
    }
    if (global.document?.visibilityState === 'hidden') {
      global.addEventListener?.('visibilitychange', this._attempt);
    } else {
      global.addEventListener?.('online', this._attempt);
      this._timeout = setTimeout(this._attempt, this._delayGetter(this._attempts));
    }
    global.addEventListener?.('pageshow', this._attempt);
    global.addEventListener?.('focus', this._attempt);
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
      this._handler = null;
      this._attempts = 0;
    } catch (_ignore) {
      if (!ac.signal.aborted) {
        ac.abort();
        const h = this._handler;
        if (h) {
          this._handler = null;
          this.schedule(h);
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
