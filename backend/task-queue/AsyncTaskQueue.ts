import type { Task, TaskQueue } from './TaskQueue';

type QueueItem = () => Promise<void>;

export class AsyncTaskQueue extends EventTarget implements TaskQueue {
  private readonly _queue: QueueItem[] = [];

  private _running = false;

  public push<T>(task: Task<T>) {
    return new Promise<T>((resolve, reject) => {
      this._queue.push(async () => {
        try {
          resolve(await task());
        } catch (e) {
          reject(e);
        }
      });
      if (!this._running) {
        this._internalConsumeQueue();
      }
    });
  }

  private async _internalConsumeQueue() {
    this._running = true;
    while (this._queue.length > 0) {
      await this._queue.shift()!();
    }
    this._running = false;
    this.dispatchEvent(new CustomEvent('drain'));
  }

  public active(): boolean {
    return this._running;
  }
}
