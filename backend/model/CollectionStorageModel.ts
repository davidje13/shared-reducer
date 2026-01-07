import type { Model } from './Model';

// this is a subset of collection-storage's Collection<T>
interface Collection<T> {
  where<K extends string & keyof T>(attribute: K, value: T[K]): Filtered<T>;
}
interface Filtered<T> {
  get(): Promise<Readonly<T> | null>;
  update(delta: Partial<T>): Promise<void>;
}

type ErrorMapper = (e: unknown) => unknown;

const ERROR_NOP: ErrorMapper = (e) => e;

export class CollectionStorageModel<T extends object, K extends keyof T & string>
  implements Model<T[K], T>
{
  private readonly _readErrorIntercept: ErrorMapper;
  private readonly _writeErrorIntercept: ErrorMapper;

  constructor(
    private readonly _collection: Collection<T>,
    private readonly _idCol: keyof T & string,
    public readonly validate: (v: unknown) => T,
    options: {
      readErrorIntercept?: ErrorMapper;
      writeErrorIntercept?: ErrorMapper;
    } = {},
  ) {
    this._readErrorIntercept = options.readErrorIntercept ?? ERROR_NOP;
    this._writeErrorIntercept = options.writeErrorIntercept ?? ERROR_NOP;
  }

  public async read(id: T[K]): Promise<Readonly<T> | null> {
    try {
      return await this._collection.where(this._idCol, id).get();
    } catch (e) {
      throw this._readErrorIntercept(e);
    }
  }

  public async write(id: T[K], newValue: T, oldValue: T) {
    const diff: Partial<T> = {};
    Object.entries(newValue).forEach(([k, value]) => {
      const key = k as keyof T & string;
      const old = Object.prototype.hasOwnProperty.call(oldValue, key) ? oldValue[key] : undefined;
      if (value !== old) {
        if (diff[key]) {
          Object.defineProperty(diff, key, {
            value,
            configurable: true,
            enumerable: true,
            writable: true,
          });
        } else {
          diff[key] = value;
        }
      }
    });

    try {
      await this._collection.where(this._idCol, id).update(diff);
    } catch (e) {
      throw this._writeErrorIntercept(e);
    }
  }
}
