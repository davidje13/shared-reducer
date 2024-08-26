import { type Permission, PermissionError } from './Permission';

export class ReadWriteStruct<T extends object> implements Permission<T, unknown> {
  constructor(private readonly _readOnlyFields: (keyof T)[] = []) {}

  public validateWrite(newValue: T, oldValue: T) {
    Object.keys(oldValue).forEach((k) => {
      const key = k as keyof T & string;

      if (!Object.prototype.hasOwnProperty.call(newValue, key)) {
        if (this._readOnlyFields.includes(key)) {
          throw new PermissionError(`Cannot remove field ${key}`);
        }
      }
    });

    Object.keys(newValue).forEach((k) => {
      const key = k as keyof T & string;

      if (this._readOnlyFields.includes(key)) {
        if (!Object.prototype.hasOwnProperty.call(oldValue, key)) {
          throw new PermissionError(`Cannot add field ${key}`);
        }
        if (newValue[key] !== oldValue[key]) {
          throw new PermissionError(`Cannot edit field ${key}`);
        }
      }
    });
  }
}
