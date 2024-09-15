import { OnlineScheduler, exponentialDelay } from './OnlineScheduler';

describe('OnlineScheduler', () => {
  it('invokes immediately when trigger is called', async () => {
    const scheduler = new OnlineScheduler(() => 1, 1000);
    const handler = mock().returning('result');
    scheduler.trigger(handler);

    expect(handler).toHaveBeenCalled();

    await sleep(10); // stops on success
    expect(handler).toHaveBeenCalled({ times: 1 });
  });

  it('repeatedly invokes the handler if it fails until stopped', async () => {
    const delayFn = mock().returning(10);
    const scheduler = new OnlineScheduler(delayFn, 1000);
    const handler = mock().throwing(new Error('nope'));
    scheduler.trigger(handler);

    expect(handler).toHaveBeenCalled({ times: 1 });
    await sleep(5);
    expect(delayFn).toHaveBeenCalled({ times: 1 });
    await sleep(10);
    expect(handler).toHaveBeenCalled({ times: 2 });
    expect(delayFn).toHaveBeenCalled({ times: 2 });
    await sleep(10);
    expect(handler).toHaveBeenCalled({ times: 3 });
    expect(delayFn).toHaveBeenCalled({ times: 3 });

    scheduler.stop();

    await sleep(10);
    expect(handler).toHaveBeenCalled({ times: 3 });
    expect(delayFn).toHaveBeenCalled({ times: 3 });
  });

  it('awaits the handler up to the configured limit', async () => {
    const scheduler = new OnlineScheduler(() => 10, 50);
    const handler = mock<(s: AbortSignal) => Promise<void>>().returning(new Promise(() => null));
    scheduler.trigger(handler);

    expect(handler).toHaveBeenCalled({ times: 1 });
    await sleep(40);
    expect(handler.getInvocation(0).arguments[0].aborted).isFalse();
    expect(handler).toHaveBeenCalled({ times: 1 });
    await sleep(30);
    expect(handler).toHaveBeenCalled({ times: 2 });
    expect(handler.getInvocation(0).arguments[0].aborted).isTrue();
    expect(handler.getInvocation(1).arguments[0].aborted).isFalse();

    scheduler.stop();
    expect(handler.getInvocation(1).arguments[0].aborted).isTrue();
  });
});

describe('exponentialDelay', () => {
  it('returns an exponentially increasing number as the attempt increases', () => {
    const delayFn = exponentialDelay({ base: 2, initialDelay: 100, maxDelay: 1000, randomness: 0 });
    expect(delayFn(0)).toEqual(100);
    expect(delayFn(1)).toEqual(200);
    expect(delayFn(2)).toEqual(400);
    expect(delayFn(3)).toEqual(800);
    expect(delayFn(4)).toEqual(1000);
    expect(delayFn(5)).toEqual(1000);
  });

  it('includes randomness if configured', () => {
    const delayFn = exponentialDelay({
      base: 2,
      initialDelay: 100,
      maxDelay: 1000,
      randomness: 0.2,
    });

    for (let i = 0; i < 100; ++i) {
      const d0 = delayFn(0);
      expect(d0).toBeGreaterThanOrEqual(80);
      expect(d0).toBeLessThanOrEqual(100);

      const d3 = delayFn(3);
      expect(d3).toBeGreaterThanOrEqual(640);
      expect(d3).toBeLessThanOrEqual(800);

      const d10 = delayFn(10);
      expect(d10).toBeGreaterThanOrEqual(800);
      expect(d10).toBeLessThanOrEqual(1000);
    }
  });
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
