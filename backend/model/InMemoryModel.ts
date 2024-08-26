import type { Model } from './Model';

export class InMemoryModel<T> implements Model<T> {
  public readonly read = this.get;

  public readonly validate: (v: unknown) => T;

  private readonly _memory = new Map<string, T>();

  constructor(validator = (x: unknown): T => x as T) {
    this.validate = validator;
  }

  public set(id: string, value: T) {
    this._memory.set(id, value);
  }

  public get(id: string): Readonly<T> | undefined {
    return this._memory.get(id);
  }

  public delete(id: string) {
    this._memory.delete(id);
  }

  public write(id: string, newValue: T, oldValue: T) {
    const old = this._memory.get(id);
    if (oldValue !== old) {
      throw new Error('Unexpected previous value');
    }
    this._memory.set(id, newValue);
  }
}
