import type { MaybePromise } from '../helpers/MaybePromise';

export type Handler = (signal: AbortSignal) => MaybePromise<void>;
export type ErrorHandler = (e: unknown) => void;

export interface Scheduler {
  trigger(fn: Handler, errorHandler: ErrorHandler): void;
  schedule(fn: Handler, errorHandler: ErrorHandler): void;
  stop(): void;
}
