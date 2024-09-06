import type { Model } from './Model';

export class InMemoryModel<ID, T> implements Model<ID, T> {
  public readonly read = this.get;

  public readonly validate: (v: unknown) => T;

  private readonly _memory = new Map<ID, T>();

  constructor(validator = (x: unknown): T => x as T) {
    this.validate = validator;
  }

  public set(id: ID, value: T) {
    this._memory.set(id, value);
  }

  public get(id: ID): Readonly<T> | undefined {
    return this._memory.get(id);
  }

  public delete(id: ID) {
    this._memory.delete(id);
  }

  public write(id: ID, newValue: T, oldValue: T) {
    const old = this._memory.get(id);
    if (oldValue !== old) {
      throw new Error('Unexpected previous value');
    }
    this._memory.set(id, newValue);
  }
}
