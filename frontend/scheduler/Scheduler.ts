export interface Scheduler {
  trigger(fn: (signal: AbortSignal) => Promise<void>): void;
  schedule(fn: (signal: AbortSignal) => Promise<void>): void;
  stop(): void;
}
