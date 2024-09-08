import type { MaybePromise } from '../helpers/MaybePromise';

export interface Model<ID, T> {
  validate(v: unknown): Readonly<T>;

  read(id: ID): MaybePromise<Readonly<T> | null | undefined>;

  write(id: ID, newValue: T, oldValue: T): MaybePromise<void>;
}
