export interface Context<T, SpecT> {
  update: (input: T, spec: SpecT) => T;
  combine: (specs: SpecT[]) => SpecT;
}

export type SpecGenerator<T, SpecT> = (state: T) => SpecSource<T, SpecT>[];
export type SpecSource<T, SpecT> = SpecT | SpecGenerator<T, SpecT> | null;

export type DispatchSpec<T, SpecT> = SpecSource<T, SpecT>[];

export interface Dispatch<T, SpecT> {
  sync(specs?: DispatchSpec<T, SpecT>): Promise<T>;
  (
    specs: DispatchSpec<T, SpecT>,
    syncedCallback?: (state: T) => void,
    errorCallback?: (error: string) => void,
  ): void;
}
