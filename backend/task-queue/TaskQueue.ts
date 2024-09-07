export type Task<T> = () => Promise<T> | T;

export interface TaskQueue extends EventTarget {
  push<T>(task: Task<T>): Promise<T>;
  active(): boolean;
}

export type TaskQueueFactory = () => TaskQueue;
