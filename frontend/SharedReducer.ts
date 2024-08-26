import type { Context, Dispatch, SpecSource, SyncCallback } from './DispatchSpec';
import { WebSocketConnection } from './WebSocketConnection';
import { reduce } from './reduce';
import { actionsSyncedCallback } from './actions/actionsSyncedCallback';
import { idProvider } from './idProvider';
import { lock } from './lock';

interface InitEvent<T> {
  init: T;
  id?: undefined;
}

interface ChangeEvent<SpecT> {
  change: SpecT;
  id?: number;
}

interface LocalChange<T, SpecT> {
  change: SpecT;
  id: number;
  syncCallbacks: SyncCallback<T>[];
}

interface LocalChangeIndex<T, SpecT> {
  localChange: LocalChange<T, SpecT> | null;
  index: number;
}

interface ApiError {
  error: string;
  id?: number;
}

interface State<T> {
  readonly server: T;
  readonly local: T;
}

interface SharedReducerBuilder<T, SpecT> {
  withReducer<SpecT2 extends SpecT>(context: Context<T, SpecT2>): SharedReducerBuilder<T, SpecT2>;

  withToken(token: string): this;

  withErrorHandler(handler: (error: string) => void): this;

  withWarningHandler(handler: (error: string) => void): this;

  build(): SharedReducer<T, SpecT>;
}

export class SharedReducer<T, SpecT> {
  private readonly _connection: WebSocketConnection;

  private _latestStates: State<T> | null = null;

  private _currentChange: SpecT | undefined;

  private _currentSyncCallbacks: SyncCallback<T>[] = [];

  private _localChanges: LocalChange<T, SpecT>[] = [];

  private _pendingChanges: SpecSource<T, SpecT>[] = [];

  private readonly _dispatchLock = lock('Cannot dispatch recursively');

  private readonly _nextId = idProvider();

  private constructor(
    private readonly _context: Context<T, SpecT>,
    wsUrl: string,
    token: string | undefined,
    private readonly _changeHandler: ((state: T) => void) | undefined,
    errorHandler: ((error: string) => void) | undefined,
    private readonly _warningHandler: ((error: string) => void) | undefined,
  ) {
    this._connection = new WebSocketConnection(wsUrl, token, this._handleMessage, errorHandler);
  }

  public static for<T2>(
    wsUrl: string,
    changeHandler?: (state: T2) => void,
  ): SharedReducerBuilder<T2, unknown> {
    let bContext: Context<T2, unknown>;
    let bToken: string;
    let bErrorHandler: (error: string) => void;
    let bWarningHandler: (error: string) => void;

    return {
      withReducer<SpecT2>(context: Context<T2, SpecT2>) {
        bContext = context as Context<T2, unknown>;
        return this as SharedReducerBuilder<T2, SpecT2>;
      },

      withToken(token: string) {
        bToken = token;
        return this;
      },

      withErrorHandler(handler: (error: string) => void) {
        bErrorHandler = handler;
        return this;
      },

      withWarningHandler(handler: (error: string) => void) {
        bWarningHandler = handler;
        return this;
      },

      build() {
        if (!bContext) {
          throw new Error('must set broadcaster context');
        }
        return new SharedReducer(
          bContext,
          wsUrl,
          bToken,
          changeHandler,
          bErrorHandler,
          bWarningHandler,
        );
      },
    };
  }

  public close() {
    this._connection.close();
    this._latestStates = null;
    this._currentChange = undefined;
    this._currentSyncCallbacks = [];
    this._localChanges = [];
    this._pendingChanges = [];
  }

  public dispatch: Dispatch<T, SpecT> = (specs) => {
    if (!specs || !specs.length) {
      return;
    }

    if (this._latestStates) {
      const updatedState = this._applySpecs(this._latestStates, specs);
      if (updatedState !== this._latestStates) {
        this._latestStates = updatedState;
        this._changeHandler?.(updatedState.local);
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

    this._localChanges.push({ change, id, syncCallbacks });
    this._connection.send({ change, id });
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

  private _handleErrorMessage(message: ApiError) {
    const { localChange } = this._popLocalChange(message.id);
    if (!localChange) {
      this._warningHandler?.(`API sent error: ${message.error}`);
      return;
    }
    this._warningHandler?.(`API rejected update: ${message.error}`);
    if (this._latestStates) {
      this._latestStates = this._computeLocal(this._latestStates.server);
      this._changeHandler?.(this._latestStates.local);
    }
    localChange.syncCallbacks.forEach((fn) => fn.reject(message.error));
  }

  private _handleInitMessage(message: InitEvent<T>) {
    this._latestStates = this._applySpecs(this._computeLocal(message.init), this._pendingChanges);
    this._pendingChanges.length = 0;
    this._changeHandler?.(this._latestStates.local);
  }

  private _handleChangeMessage(message: ChangeEvent<SpecT>) {
    if (!this._latestStates) {
      this._warningHandler?.(`Ignoring change before init: ${JSON.stringify(message)}`);
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
      this._changeHandler?.(this._latestStates.local);
    }
    const state = this._latestStates.local;
    localChange?.syncCallbacks.forEach((callback) => callback.sync(state));
  }

  private _handleMessage = (message: unknown) => {
    if (Object.prototype.hasOwnProperty.call(message, 'change')) {
      this._handleChangeMessage(message as ChangeEvent<SpecT>);
    } else if (Object.prototype.hasOwnProperty.call(message, 'init')) {
      this._handleInitMessage(message as InitEvent<T>);
    } else if (Object.prototype.hasOwnProperty.call(message, 'error')) {
      this._handleErrorMessage(message as ApiError);
    } else {
      this._warningHandler?.(`Ignoring unknown API message: ${JSON.stringify(message)}`);
    }
  };

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
}
