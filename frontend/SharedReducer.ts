import type { Context, Dispatch, SpecSource, SyncCallback } from './DispatchSpec';
import { reduce } from './reduce';
import { actionsSyncedCallback } from './actions/actionsSyncedCallback';
import { idProvider } from './idProvider';
import { lock } from './lock';
import { ReconnectingWebSocket } from './ReconnectingWebSocket';
import type { MaybePromise } from './helpers/MaybePromise';
import { AT_LEAST_ONCE, type ReconnectionStrategy } from './reconnection/strategies';

interface InitEvent<T> {
  init: T;
  id?: undefined;
}

interface ChangeEvent<SpecT> {
  change: SpecT;
  id?: number;
}

interface ApiError {
  error: string;
  id?: number;
}

type ServerEvent<T, SpecT> = InitEvent<T> | ChangeEvent<SpecT> | ApiError;

interface LocalChange<T, SpecT> {
  change: SpecT;
  id: number;
  syncCallbacks: SyncCallback<T>[];
  sent: boolean;
}

interface LocalChangeIndex<T, SpecT> {
  localChange: LocalChange<T, SpecT> | null;
  index: number;
}

interface State<T> {
  readonly server: T;
  readonly local: T;
}

export class SharedReducer<T, SpecT> extends EventTarget {
  private readonly _ws: ReconnectingWebSocket;

  private _latestStates: State<T> | null = null;

  private _currentChange: SpecT | undefined;

  private _currentSyncCallbacks: SyncCallback<T>[] = [];

  private _localChanges: LocalChange<T, SpecT>[] = [];

  private _pendingChanges: SpecSource<T, SpecT>[] = [];

  private readonly _listeners: Set<(state: T) => void> = new Set();

  private readonly _dispatchLock = lock('Cannot dispatch recursively');

  private readonly _nextId = idProvider();

  public constructor(
    private readonly _context: Context<T, SpecT>,
    connectionGetter: () => MaybePromise<{ url: string; token?: string }>,
    private readonly _reconnectionStrategy: ReconnectionStrategy<T, SpecT> = AT_LEAST_ONCE,
  ) {
    super();
    this._ws = new ReconnectingWebSocket(connectionGetter);
    this._ws.addEventListener('message', this._handleMessage);
    this._ws.addEventListener('connected', this._forwardEvent);
    this._ws.addEventListener('disconnected', this._forwardEvent);
  }

  private readonly _handleMessage = (e: Event) => {
    const message = JSON.parse((e as CustomEvent).detail) as ServerEvent<T, SpecT>;
    if ('change' in message) {
      this._handleChangeMessage(message);
    } else if ('init' in message) {
      this._handleInitMessage(message);
    } else if ('error' in message) {
      this._handleErrorMessage(message);
    } else {
      this.dispatchEvent(
        new CustomEvent('warning', {
          detail: new Error(`Ignoring unknown API message: ${JSON.stringify(message)}`),
        }),
      );
    }
  };

  private _handleInitMessage(message: InitEvent<T>) {
    this._localChanges = this._localChanges.filter((c) => {
      if (this._reconnectionStrategy(message.init, c.change, c.sent)) {
        return true;
      }
      c.syncCallbacks.forEach((fn) => fn.reject('message possibly lost'));
      return false;
    });
    this._latestStates = this._applySpecs(this._computeLocal(message.init), this._pendingChanges);
    this._pendingChanges.length = 0;
    this._sendState(this._latestStates.local);

    if (this._ws.isConnected()) {
      for (const { change, id } of this._localChanges) {
        this._ws.send(JSON.stringify({ change, id }));
      }
    }
  }

  private _handleChangeMessage(message: ChangeEvent<SpecT>) {
    if (!this._latestStates) {
      this.dispatchEvent(
        new CustomEvent('warning', {
          detail: new Error(`Ignoring change before init: ${JSON.stringify(message)}`),
        }),
      );
      return;
    }

    const { localChange, index } = this._popLocalChange(message.id);

    const server = this._context.update(this._latestStates.server, message.change);

    if (index === 0) {
      // just removed the oldest pending change and applied it to
      // the base server state: nothing has changed
      this._latestStates = { server, local: this._latestStates.local };
    } else {
      this._latestStates = this._computeLocal(server);
      this._sendState(this._latestStates.local);
    }
    const state = this._latestStates.local;
    localChange?.syncCallbacks.forEach((callback) => callback.sync(state));
  }

  private _handleErrorMessage(message: ApiError) {
    const { localChange } = this._popLocalChange(message.id);
    if (!localChange) {
      this.dispatchEvent(
        new CustomEvent('warning', {
          detail: new Error(`API sent error: ${message.error}`),
        }),
      );
      return;
    }
    this.dispatchEvent(
      new CustomEvent('warning', {
        detail: new Error(`API rejected update: ${message.error}`),
      }),
    );
    if (this._latestStates) {
      this._latestStates = this._computeLocal(this._latestStates.server);
      this._sendState(this._latestStates.local);
    }
    localChange.syncCallbacks.forEach((fn) => fn.reject(message.error));
  }

  public addStateListener(listener: (state: T) => void) {
    this._listeners.add(listener);
    if (this._latestStates !== null) {
      listener(this._latestStates.local);
    }
  }

  public removeStateListener(listener: (state: T) => void) {
    this._listeners.delete(listener);
  }

  private _sendState(state: T) {
    for (const listener of this._listeners) {
      listener(state);
    }
  }

  public dispatch: Dispatch<T, SpecT> = (specs) => {
    if (!specs || !specs.length) {
      return;
    }

    if (this._latestStates) {
      const updatedState = this._applySpecs(this._latestStates, specs);
      if (updatedState !== this._latestStates) {
        this._latestStates = updatedState;
        this._sendState(updatedState.local);
      }
    } else {
      this._pendingChanges.push(...specs);
    }
  };

  public addSyncCallback(resolve: (state: T) => void, reject?: (message: string) => void) {
    this.dispatch([actionsSyncedCallback(resolve, reject)]);
  }

  public syncedState(): Promise<T> {
    return new Promise((resolve, reject) => {
      this.addSyncCallback(resolve, reject);
    });
  }

  public getState(): T | undefined {
    return this._latestStates?.local;
  }

  private _sendCurrentChange = () => {
    if (this._currentChange === undefined) {
      return;
    }

    const id = this._nextId();
    const change = this._currentChange;
    const syncCallbacks = this._currentSyncCallbacks;
    this._currentChange = undefined;
    this._currentSyncCallbacks = [];

    const localChange: LocalChange<T, SpecT> = { change, id, syncCallbacks, sent: false };
    if (this._ws.isConnected()) {
      localChange.sent = true;
      this._ws.send(JSON.stringify({ change, id }));
    }
    this._localChanges.push(localChange);
  };

  private _addCurrentChange(spec: SpecT) {
    if (this._currentChange === undefined) {
      this._currentChange = spec;
      setTimeout(this._sendCurrentChange, 0);
    } else {
      this._currentChange = this._context.combine([this._currentChange, spec]);
    }
  }

  private _applySpecs(old: State<T>, specs: SpecSource<T, SpecT>[]): State<T> {
    if (!specs.length) {
      // optimisation for pendingChanges
      return old;
    }

    const { state, delta } = this._dispatchLock(() =>
      reduce(this._context, old.local, specs, (syncCallback, curState) => {
        if (curState === old.local && this._currentChange === undefined) {
          syncCallback.sync(old.local);
        } else {
          this._currentSyncCallbacks.push(syncCallback);
        }
      }),
    );

    if (state === old.local) {
      return old;
    }

    this._addCurrentChange(delta);
    return {
      server: old.server,
      local: state,
    };
  }

  private _popLocalChange(id: number | undefined): LocalChangeIndex<T, SpecT> {
    const index = id === undefined ? -1 : this._localChanges.findIndex((c) => c.id === id);
    if (index === -1) {
      return { localChange: null, index };
    }
    return {
      localChange: this._localChanges.splice(index, 1)[0]!,
      index,
    };
  }

  private _computeLocal(server: T): State<T> {
    let local = server;
    if (this._localChanges.length > 0) {
      const changes = this._context.combine(this._localChanges.map(({ change }) => change));
      local = this._context.update(local, changes);
    }
    if (this._currentChange !== undefined) {
      local = this._context.update(local, this._currentChange);
    }
    return { server, local };
  }

  private readonly _forwardEvent = (e: Event) => {
    this.dispatchEvent(new CustomEvent(e.type, { detail: (e as CustomEvent).detail }));
  };

  public close() {
    this._ws.close();
    this._latestStates = null;
    this._currentChange = undefined;
    this._currentSyncCallbacks = [];
    this._localChanges = [];
    this._pendingChanges = [];
    this._ws.removeEventListener('message', this._handleMessage);
    this._ws.removeEventListener('connected', this._forwardEvent);
    this._ws.removeEventListener('disconnected', this._forwardEvent);
  }
}
