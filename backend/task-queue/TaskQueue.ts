import type { MaybePromise } from '../helpers/MaybePromise';

export type Task<T> = () => MaybePromise<T>;

export interface TaskQueue extends EventTarget {
  push<T>(task: Task<T>): Promise<T>;
  active(): boolean;
}

export type TaskQueueFactory = () => TaskQueue;
