import { TaskQueueMap } from './TaskQueueMap';
import type { Task, TaskQueue } from './TaskQueue';

function setup(): { returnedQueues: FakeQueue<string>[]; map: TaskQueueMap<string, string> } {
  const returnedQueues: FakeQueue<string>[] = [];
  const map = new TaskQueueMap<string, string>(() => {
    const queue = new FakeQueue<string>();
    returnedQueues.push(queue);
    return queue;
  });
  return { returnedQueues, map };
}

describe('TaskQueueMap', () => {
  it('propagates results from queued tasks', async () => {
    const { map } = setup();
    const result = await map.push('a', async () => 'A');

    expect(result).toEqual('A');
  });

  it('propagates errors from queued tasks', async () => {
    const { map } = setup();
    await expect(() =>
      map.push('a', () => {
        throw new Error('nope');
      }),
    ).throws('nope');
  });

  it('maintains separate queues for each key', async () => {
    const { map, returnedQueues } = setup();
    map.push('a', async () => 'A');
    expect(returnedQueues.length).toEqual(1);

    map.push('b', async () => 'B');
    expect(returnedQueues.length).toEqual(2);

    map.push('b', async () => 'C');
    expect(returnedQueues.length).toEqual(2);
    expect(returnedQueues[1]!.taskCount).toEqual(2);
  });

  it('removes queues after "drain" is emitted', async () => {
    const { map, returnedQueues } = setup();
    await map.push('a', async () => 'A');
    expect(returnedQueues.length).toEqual(1);

    await map.push('a', async () => 'B');
    expect(returnedQueues.length).toEqual(1);
    expect(returnedQueues[0]!.taskCount).toEqual(2);

    returnedQueues[0]!.dispatchEvent(new CustomEvent('drain'));

    await map.push('a', async () => 'C');
    expect(returnedQueues.length).toEqual(2);
    expect(returnedQueues[1]!.taskCount).toEqual(1);
  });
});

class FakeQueue<T> extends EventTarget implements TaskQueue<T> {
  public taskCount = 0;

  public push(task: Task<T>): Promise<T> {
    this.taskCount += 1;
    return task();
  }
}
