export type Task<T> = () => Promise<T>;

export interface TaskQueue<T> extends EventTarget {
  push(task: Task<T>): Promise<T>;
  active?: () => boolean;
}

export type TaskQueueFactory<T> = () => TaskQueue<T>;
