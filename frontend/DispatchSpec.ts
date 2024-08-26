export interface Context<T, SpecT> {
  update: (input: T, spec: SpecT) => T;
  combine: (specs: SpecT[]) => SpecT;
}

export class SyncCallback<T> {
  constructor(
    public readonly sync: (state: T) => void,
    public readonly reject: (message: string) => void,
  ) {}
}
export type SpecGenerator<T, SpecT> = (state: T) => SpecSource<T, SpecT>[] | null | undefined;
export type SpecSource<T, SpecT> =
  | SpecT
  | SpecGenerator<T, SpecT>
  | SyncCallback<T>
  | null
  | undefined;

export type DispatchSpec<T, SpecT> = SpecSource<T, SpecT>[];
export type Dispatch<T, SpecT> = (specs: DispatchSpec<T, SpecT> | null | undefined) => void;
