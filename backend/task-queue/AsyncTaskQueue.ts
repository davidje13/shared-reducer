import type { Task, TaskQueue } from './TaskQueue';

interface QueueItem<T> {
  task: Task<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
}

export class AsyncTaskQueue<T> extends EventTarget implements TaskQueue<T> {
  private readonly _queue: QueueItem<T>[] = [];

  private _running = false;

  public push(task: Task<T>) {
    return new Promise<T>((resolve, reject) => {
      this._queue.push({ task, resolve, reject });
      if (!this._running) {
        this._internalConsumeQueue();
      }
    });
  }

  private async _internalConsumeQueue() {
    this._running = true;
    while (this._queue.length > 0) {
      const { task, resolve, reject } = this._queue.shift()!;

      let result = null;
      let success = false;
      try {
        result = await task();
        success = true;
      } catch (e) {
        reject(e as Error);
      }
      if (success) {
        resolve(result!);
      }
    }
    this._running = false;
    this.dispatchEvent(new CustomEvent('drain'));
  }
}
