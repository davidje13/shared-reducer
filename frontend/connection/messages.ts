export interface InitMessage<T> {
  init: T;
  id?: undefined;
}

export interface ChangeMessage<SpecT> {
  change: SpecT;
  id?: number;
}

export interface ErrorMessage {
  error: string;
  id?: number;
}

export type ServerMessage<T, SpecT> = InitMessage<T> | ChangeMessage<SpecT> | ErrorMessage;
