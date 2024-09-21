import type { DeliveryStrategy } from './deliveryStrategies';
import type { Context } from '../DispatchSpec';
import { idProvider } from '../helpers/idProvider';

export class LocalChangeTracker<T, SpecT> {
  private readonly _items: LocalChange<T, SpecT>[] = [];
  private readonly _nextId = idProvider();

  public constructor(
    private readonly _context: Context<T, SpecT>,
    private readonly _deliveryStrategy: DeliveryStrategy<T, SpecT>,
  ) {}

  public _add(delta: SpecT) {
    this._items.push({ _id: undefined, _change: delta, _resolve: [], _reject: [] });
  }

  public _addCallback(
    currentState: T,
    resolve: ((state: T) => void) | undefined,
    reject: ((message: string) => void) | undefined,
  ) {
    if (!resolve && !reject) {
      return;
    }
    if (this._items.length) {
      const latest = this._items[this._items.length - 1]!;
      latest._resolve.push(resolve ?? NOOP);
      latest._reject.push(reject ?? NOOP);
    } else if (resolve) {
      Promise.resolve(currentState).then(resolve);
    }
  }

  public _requeue(serverState: T) {
    let del = 0;
    for (let i = 0; i < this._items.length; ++i) {
      const c = this._items[i]!;
      if (!this._deliveryStrategy(serverState, c._change, c._id !== undefined)) {
        c._reject.forEach((f) => f('message possibly lost'));
        ++del;
      } else {
        c._id = undefined;
        this._items[i - del] = c;
      }
    }
    this._items.length -= del;
  }

  public _send(sender: (message: string) => void) {
    for (let i = 0, rangeStart = 0; i <= this._items.length; ++i) {
      const item = this._items[i];
      if (!item || item._id !== undefined || item._resolve.length > 0 || item._reject.length > 0) {
        const count = i - rangeStart;
        if (count > 1) {
          const combined = this._items[i - 1]!;
          const parts = this._items.splice(rangeStart, count, combined);
          combined._change = this._context.combine(parts.map((p) => p._change));
          i -= count - 1;
        }
        rangeStart = i + 1;
      }
    }

    for (const change of this._items) {
      if (change._id === undefined) {
        change._id = this._nextId();
        sender(JSON.stringify({ change: change._change, id: change._id }));
      }
    }
  }

  public _popChange(id: number | undefined): LocalChangeIndex<T, SpecT> {
    const index = id === undefined ? -1 : this._items.findIndex((c) => c._id === id);
    if (index === -1) {
      return { _localChange: null, _isFirst: false };
    }
    return {
      _localChange: this._items.splice(index, 1)[0]!,
      _isFirst: index === 0,
    };
  }

  public _computeLocal(server: T): T {
    if (!this._items.length) {
      return server;
    }
    const changes = this._context.combine(this._items.map(({ _change }) => _change));
    return this._context.update(server, changes);
  }
}

const NOOP = () => null;

interface LocalChange<T, SpecT> {
  _id: number | undefined;
  _change: SpecT;
  _resolve: ((state: T) => void)[];
  _reject: ((message: string) => void)[];
}

interface LocalChangeIndex<T, SpecT> {
  _localChange: LocalChange<T, SpecT> | null;
  _isFirst: boolean;
}
