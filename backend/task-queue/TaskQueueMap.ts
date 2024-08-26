import { AsyncTaskQueue } from './AsyncTaskQueue';
import type { TaskQueue, Task } from './TaskQueue';

export class TaskQueueMap<T> {
  private readonly _queues = new Map<string, TaskQueue<T>>();

  public constructor(
    private readonly _queueFactory = (): TaskQueue<T> => new AsyncTaskQueue<T>(),
  ) {}

  public push(key: string, task: Task<T>): Promise<T> {
    let queue = this._queues.get(key);
    if (!queue) {
      queue = this._queueFactory();
      queue.addEventListener('drain', () => {
        this._queues.delete(key);
      });
      this._queues.set(key, queue);
    }
    return queue.push(task);
  }
}
