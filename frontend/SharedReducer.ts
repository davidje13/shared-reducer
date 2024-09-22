import type { Context, Dispatch, DispatchSpec, SpecSource } from './DispatchSpec';
import { reduce } from './reduce';
import { lock } from './helpers/lock';
import {
  ReconnectingWebSocket,
  type ConnectionGetter,
  type DisconnectDetail,
} from './connection/ReconnectingWebSocket';
import { AT_LEAST_ONCE, type DeliveryStrategy } from './connection/deliveryStrategies';
import { exponentialDelay, OnlineScheduler } from './scheduler/OnlineScheduler';
import type { Scheduler } from './scheduler/Scheduler';
import type {
  ChangeMessage,
  ErrorMessage,
  InitMessage,
  ServerMessage,
} from './connection/messages';
import { LocalChangeTracker } from './connection/LocalChangeTracker';
import { debounce } from './helpers/debounce';
import { makeEvent, TypedEventTarget } from './helpers/TypedEventTarget';

export interface SharedReducerOptions<T, SpecT> {
  scheduler?: Scheduler | undefined;
  deliveryStrategy?: DeliveryStrategy<T, SpecT> | undefined;
}

type SharedReducerEvents = {
  connected: CustomEvent<void>;
  disconnected: CustomEvent<DisconnectDetail>;
  warning: CustomEvent<Error>;
};

export class SharedReducer<T, SpecT> extends TypedEventTarget<SharedReducerEvents> {
  private readonly _ws: ReconnectingWebSocket;
  private _paused = true;
  private _state: State<T, SpecT> = { _stage: 0, _queue: [] };
  private readonly _tracker: LocalChangeTracker<T, SpecT>;
  private readonly _listeners: Set<(state: T) => void> = new Set();
  private readonly _dispatchLock = lock('Cannot dispatch recursively');

  public constructor(
    private readonly _context: Context<T, SpecT>,
    connectionGetter: ConnectionGetter,
    {
      scheduler = new OnlineScheduler(DEFAULT_RECONNECT, 20 * 1000),
      deliveryStrategy = AT_LEAST_ONCE,
    }: SharedReducerOptions<T, SpecT> = {},
  ) {
    super();
    this._tracker = new LocalChangeTracker<T, SpecT>(_context, deliveryStrategy);
    this._ws = new ReconnectingWebSocket(connectionGetter, scheduler);
    this._ws.addEventListener('message', this._handleMessage);
    this._ws.addEventListener('connected', this._handleConnected);
    this._ws.addEventListener('connectionfailure', this._handleConnectionFailure);
    this._ws.addEventListener('disconnected', this._handleDisconnected);
  }

  public readonly dispatch = makeDispatch<T, SpecT>((specs, resolve, reject) => {
    if (!specs.length && !resolve && !reject) {
      return;
    }

    const item: DispatchArgs<T, SpecT> = { _specs: specs, _resolve: resolve, _reject: reject };
    switch (this._state._stage) {
      case -1:
        throw new Error('closed');
      case 0:
        this._state._queue.push(item);
        break;
      case 1:
        this._setLocalState(this._apply(this._state._local, [item]));
        this._share._schedule();
        break;
    }
  });

  private _apply(localState: T, changes: DispatchArgs<T, SpecT>[]) {
    return this._dispatchLock(() => {
      for (const { _specs, _resolve, _reject } of changes) {
        if (_specs.length) {
          const { _state, _delta } = reduce(this._context, localState, _specs);
          localState = _state;
          this._tracker._add(_delta);
        }
        this._tracker._addCallback(localState, _resolve, _reject);
      }
      return localState;
    });
  }

  private readonly _share = debounce(() => {
    if (this._ws.isConnected() && !this._paused) {
      this._tracker._send(this._ws.send);
    }
  });

  private _handleInitMessage(message: InitMessage<T>) {
    if (this._state._stage === -1) {
      this._warn(`Ignoring init after closing: ${JSON.stringify(message)}`);
      return;
    }
    this._paused = false;
    if (this._state._stage === 0) {
      const s = this._apply(message.init, this._state._queue);
      this._state = { _stage: 1, _server: message.init, _local: s };
      this._setLocalState(s, true);
    } else {
      this._state._server = message.init;
      this._tracker._requeue(message.init);
      this._setLocalState(this._tracker._computeLocal(message.init));
    }
    this._share._run();
  }

  private _handleChangeMessage(message: ChangeMessage<SpecT>) {
    if (this._state._stage !== 1) {
      this._warn(`Ignoring change before init: ${JSON.stringify(message)}`);
      return;
    }

    const serverState = (this._state._server = this._context.update(
      this._state._server,
      message.change,
    ));

    const { _localChange, _isFirst } = this._tracker._popChange(message.id);
    if (!_isFirst) {
      this._setLocalState(this._tracker._computeLocal(serverState));
    }
    _localChange?._resolve.forEach((f) => f(serverState));
  }

  private _handleErrorMessage(message: ErrorMessage) {
    if (this._state._stage !== 1) {
      this._warn(`Ignoring error before init: ${JSON.stringify(message)}`);
      return;
    }

    const { _localChange } = this._tracker._popChange(message.id);
    if (!_localChange) {
      this._warn(`API sent error: ${message.error}`);
      return;
    }
    this._warn(`API rejected update: ${message.error}`);
    _localChange?._reject.forEach((f) => f(message.error));
    this._setLocalState(this._tracker._computeLocal(this._state._server));
  }

  private _handleGracefulClose() {
    this._ws.send('x');
    if (this._paused) {
      this._warn('Unexpected extra close message');
      return;
    }
    this._paused = true;
    this.dispatchEvent(makeEvent('disconnected', CLOSE_DETAIL));
  }

  private readonly _handleMessage = (e: CustomEvent<string>) => {
    if (e.detail === 'X') {
      this._handleGracefulClose();
      return;
    }
    const message = JSON.parse(e.detail) as ServerMessage<T, SpecT>;
    if ('change' in message) {
      this._handleChangeMessage(message);
    } else if ('init' in message) {
      this._handleInitMessage(message);
    } else if ('error' in message) {
      this._handleErrorMessage(message);
    } else {
      this._warn(`Ignoring unknown API message: ${e.detail}`);
    }
  };

  public addStateListener(listener: (state: Readonly<T>) => void) {
    this._listeners.add(listener);
    if (this._state._stage === 1) {
      listener(this._state._local);
    }
  }

  public removeStateListener(listener: (state: Readonly<T>) => void) {
    this._listeners.delete(listener);
  }

  private _setLocalState(s: T, forceSend = false) {
    if (this._state._stage !== 1) {
      throw new Error('invalid state');
    }
    if (forceSend || this._state._local !== s) {
      this._state._local = s;
      for (const listener of this._listeners) {
        listener(s);
      }
    }
  }

  public getState(): Readonly<T> | undefined {
    return this._state._stage === 1 ? this._state._local : undefined;
  }

  private _warn(message: string) {
    this.dispatchEvent(makeEvent('warning', new Error(message)));
  }

  private readonly _handleConnected = () => {
    this.dispatchEvent(makeEvent('connected'));
  };

  private readonly _handleConnectionFailure = (e: CustomEvent<DisconnectDetail>) => {
    this.dispatchEvent(
      makeEvent('warning', new Error(`connection failure: ${e.detail.code} ${e.detail.reason}`)),
    );
  };

  private readonly _handleDisconnected = (e: CustomEvent<DisconnectDetail>) => {
    if (!this._paused) {
      this._paused = true;
      this.dispatchEvent(makeEvent('disconnected', e.detail));
    }
  };

  public close() {
    this._paused = true;
    this._state = { _stage: -1 };
    this._ws.close();
    this._share._stop();
    this._listeners.clear();
    this._ws.removeEventListener('message', this._handleMessage);
    this._ws.removeEventListener('connected', this._handleConnected);
    this._ws.removeEventListener('connectionfailure', this._handleConnectionFailure);
    this._ws.removeEventListener('disconnected', this._handleDisconnected);
  }
}

function makeDispatch<T, SpecT>(
  handler: (
    specs: DispatchSpec<T, SpecT>,
    syncedCallback?: (state: T) => void,
    errorCallback?: (error: string) => void,
  ) => void,
): Dispatch<T, SpecT> {
  return Object.assign(handler, {
    sync: (specs: DispatchSpec<T, SpecT> = []) =>
      new Promise<T>((resolve, reject) =>
        handler(specs, resolve, (message) => reject(new Error(message))),
      ),
  });
}

const CLOSE_DETAIL: DisconnectDetail = { code: 0, reason: 'graceful shutdown' };

const DEFAULT_RECONNECT = exponentialDelay({
  base: 2,
  initialDelay: 200,
  maxDelay: 10 * 60 * 1000,
  randomness: 0.3,
});

interface DispatchArgs<T, SpecT> {
  _specs: SpecSource<T, SpecT>[];
  _resolve: ((state: T) => void) | undefined;
  _reject: ((message: string) => void) | undefined;
}

type State<T, SpecT> =
  | { _stage: -1 }
  | { _stage: 0; _queue: DispatchArgs<T, SpecT>[] }
  | { _stage: 1; _server: Readonly<T>; _local: Readonly<T> };
