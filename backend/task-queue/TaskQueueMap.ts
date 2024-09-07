import { AsyncTaskQueue } from './AsyncTaskQueue';
import type { TaskQueue, Task } from './TaskQueue';

export class TaskQueueMap<K> {
  private readonly _queues = new Map<K, TaskQueue>();

  public constructor(private readonly _queueFactory = (): TaskQueue => new AsyncTaskQueue()) {}

  public push<T>(key: K, task: Task<T>): Promise<T> {
    let q = this._queues.get(key);
    if (!q) {
      const queue = this._queueFactory();
      queue.addEventListener('drain', () => {
        // confirm queue has not picked up new items since the drain event was dispatched
        if (!queue.active()) {
          this._queues.delete(key);
        }
      });
      this._queues.set(key, queue);
      q = queue;
    }
    return q.push(task);
  }
}
