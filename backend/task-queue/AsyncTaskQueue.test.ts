import { ControllablePromiseFactory } from '../../test-helpers/ControllablePromiseFactory';
import { AsyncTaskQueue } from './AsyncTaskQueue';

describe('AsyncTaskQueue', () => {
  it('runs asynchronous tasks and returns the results', async () => {
    const queue = new AsyncTaskQueue();

    const result = await queue.push(async () => {
      await Promise.resolve();
      return 3;
    });

    expect(result).toEqual(3);
  });

  it('propagates exceptions', async () => {
    const queue = new AsyncTaskQueue();

    expect(async () => {
      await queue.push(async () => {
        await Promise.resolve();
        throw new Error('nope');
      });
    }).throws('nope');
  });

  it('waits for previous tasks before beginning new tasks', async () => {
    const queue = new AsyncTaskQueue();

    const task1 = new ControllablePromiseFactory();
    const task2 = new ControllablePromiseFactory();
    let result1 = null;
    let result2 = null;

    const promise1 = queue
      .push(task1.build)
      .catch((e) => ({ err: e.message }))
      .then((result) => {
        result1 = result;
      });

    const promise2 = queue
      .push(task2.build)
      .catch((e) => ({ err: e.message }))
      .then((result) => {
        result2 = result;
      });

    expect(task1.hasStarted).toEqual(true);
    expect(task2.hasStarted).toEqual(false);
    expect(result1).toEqual(null);
    expect(result2).toEqual(null);

    task1.resolve('A');
    await promise1;

    expect(task2.hasStarted).toEqual(true);
    expect(result1).toEqual('A');
    expect(result2).toEqual(null);

    task2.resolve('B');
    await promise2;

    expect(result2).toEqual('B');
  });

  it('continues after exceptions', async () => {
    const queue = new AsyncTaskQueue();

    const task1 = new ControllablePromiseFactory();
    const task2 = new ControllablePromiseFactory();
    let result1 = null;
    let result2 = null;

    const promise1 = queue
      .push(task1.build)
      .catch((e) => ({ err: e.message }))
      .then((result) => {
        result1 = result;
      });

    const promise2 = queue
      .push(task2.build)
      .catch((e) => ({ err: e.message }))
      .then((result) => {
        result2 = result;
      });

    task1.reject(new Error('nope'));
    await promise1;

    expect(task2.hasStarted).toEqual(true);
    expect(result1).toEqual({ err: 'nope' });
    expect(result2).toEqual(null);

    task2.resolve('B');
    await promise2;

    expect(result2).toEqual('B');
  });

  it('emits a "drain" event after the last item completes', async () => {
    const queue = new AsyncTaskQueue();
    const drainHandler = mock();
    queue.addEventListener('drain', drainHandler);

    const task1 = new ControllablePromiseFactory();
    const task2 = new ControllablePromiseFactory();

    const promise1 = queue.push(task1.build);
    const promise2 = queue.push(task2.build);

    expect(drainHandler).not(toHaveBeenCalled());

    task1.resolve('A');
    await promise1;
    expect(drainHandler).not(toHaveBeenCalled());

    task2.resolve('B');
    await promise2;
    await Promise.resolve();
    expect(drainHandler).toHaveBeenCalled({ times: 1 });
  });
});
