export interface Model<ID, T> {
  validate(v: unknown): Readonly<T>;

  read(id: ID): Promise<Readonly<T> | null | undefined> | Readonly<T> | null | undefined;

  write(id: ID, newValue: T, oldValue: T): Promise<void> | void;
}
