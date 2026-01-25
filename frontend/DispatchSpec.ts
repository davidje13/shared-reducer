import type { ChangeEvent } from './connection/messages';

export interface Context<T, SpecT> {
  update: (input: T, spec: SpecT) => T;
  combine: (specs: SpecT[]) => SpecT;
}

export type SpecGenerator<T, SpecT> = (state: T) => SpecSource<T, SpecT>[];
export type SpecSource<T, SpecT> = SpecT | SpecGenerator<T, SpecT> | null;

export type DispatchSpec<T, SpecT> = SpecSource<T, SpecT>[];

export type DispatchFn<T, SpecT> = (
  specs: DispatchSpec<T, SpecT>,
  options?: {
    events?: ChangeEvent[] | undefined;
    syncedCallback?: ((state: T) => void) | undefined;
    errorCallback?: ((error: string) => void) | undefined;
  },
) => void;

export interface Dispatch<T, SpecT> extends DispatchFn<T, SpecT> {
  sync(
    specs?: DispatchSpec<T, SpecT>,
    options?: { events?: ChangeEvent[] | undefined },
  ): Promise<T>;
}
