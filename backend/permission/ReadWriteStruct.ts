import { type Permission, PermissionError } from './Permission';

export class ReadWriteStruct<T extends object> implements Permission<T, unknown> {
  constructor(private readonly _readOnlyFields: (keyof T)[] = []) {}

  public validateWrite(newValue: T, oldValue: T) {
    for (const key of this._readOnlyFields) {
      const existsOld = Object.prototype.hasOwnProperty.call(oldValue, key);
      const existsNew = Object.prototype.hasOwnProperty.call(newValue, key);
      if (existsOld !== existsNew) {
        if (existsOld) {
          throw new PermissionError(`Cannot remove field ${String(key)}`);
        } else {
          throw new PermissionError(`Cannot add field ${String(key)}`);
        }
      }
      if (existsNew && oldValue[key] !== newValue[key]) {
        throw new PermissionError(`Cannot edit field ${String(key)}`);
      }
    }
  }
}
