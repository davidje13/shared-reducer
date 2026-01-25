export type ChangeEvent = [string, ...unknown[]];

export interface InitMessage<T> {
  init: T;
  id?: undefined;
}

export interface ChangeMessage<SpecT> {
  change: SpecT;
  events?: ChangeEvent[];
  id?: number;
}

export interface ErrorMessage {
  error: string;
  id?: number;
}

export type ServerMessage<T, SpecT> = InitMessage<T> | ChangeMessage<SpecT> | ErrorMessage;
