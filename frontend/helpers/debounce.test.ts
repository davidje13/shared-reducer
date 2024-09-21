import { sleep } from '../../test-helpers/sleep';
import { debounce } from './debounce';

describe('debounce', () => {
  it('schedules a function to run on the next frame', async () => {
    const fn = mock();
    const debounced = debounce(fn);
    debounced._schedule();
    expect(fn).not(toHaveBeenCalled());
    await sleep(0);
    expect(fn).toHaveBeenCalled();
  });

  it('invokes the function once', async () => {
    const fn = mock();
    const debounced = debounce(fn);
    debounced._schedule();
    debounced._schedule();
    await Promise.resolve();
    debounced._schedule();
    debounced._schedule();
    await sleep(0);
    expect(fn).toHaveBeenCalled({ times: 1 });
  });

  it('cancels if stop is called', async () => {
    const fn = mock();
    const debounced = debounce(fn);
    debounced._schedule();
    debounced._stop();
    await sleep(0);
    expect(fn).not(toHaveBeenCalled());
  });

  it('runs immediately if run is called', async () => {
    const fn = mock();
    const debounced = debounce(fn);

    debounced._run();
    expect(fn).toHaveBeenCalled({ times: 1 });

    debounced._schedule();
    debounced._run();
    expect(fn).toHaveBeenCalled({ times: 2 });
    await sleep(0);
    expect(fn).toHaveBeenCalled({ times: 2 }); // not run again
  });
});
