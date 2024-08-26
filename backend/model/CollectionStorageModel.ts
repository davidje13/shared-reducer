import type { Model } from './Model';

// type matches collection-storage
interface Collection<T> {
  get<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<Readonly<T> | null>;

  update<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
    update: Partial<T>,
  ): Promise<void>;
}

const ERROR_NOP = (e: Error): Error => e;

export class CollectionStorageModel<T extends object> implements Model<T> {
  constructor(
    private readonly _collection: Collection<T>,
    private readonly _idCol: keyof T & string,
    public readonly validate: (v: unknown) => T,
    private readonly _readErrorIntercept = ERROR_NOP,
    private readonly _writeErrorIntercept = ERROR_NOP,
  ) {}

  public async read(id: string): Promise<Readonly<T> | null> {
    try {
      return await this._collection.get(this._idCol, id as any);
    } catch (e) {
      throw this._readErrorIntercept(e as Error);
    }
  }

  public async write(id: string, newValue: T, oldValue: T) {
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
      await this._collection.update(this._idCol, id as any, diff);
    } catch (e) {
      throw this._writeErrorIntercept(e as Error);
    }
  }
}
