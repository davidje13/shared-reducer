import context from 'json-immutability-helper';
import { AT_LEAST_ONCE, AT_MOST_ONCE } from './deliveryStrategies';
import { LocalChangeTracker } from './LocalChangeTracker';

describe('LocalChangeTracker', () => {
  it('queues items to send to the server', () => {
    const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

    tracker._add(['=', 2]);

    const sent = makeJSONCaptor();
    tracker._send(sent.captor);
    expect(sent.captured).toEqual([{ id: 1, change: ['=', 2] }]);
  });

  describe('computeLocal', () => {
    it('calculates a local state based on the current items', () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

      tracker._add({ foo: ['=', 2] });
      tracker._add({ bar: ['=', 3] });

      const local = tracker._computeLocal({ foo: 0, bar: 0, baz: 0 });
      expect(local).toEqual({ foo: 2, bar: 3, baz: 0 });
    });

    it('returns the input state unchanged if there are no changes', () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

      const input = { foo: 0 };
      const local = tracker._computeLocal(input);
      expect(local).toBe(input);
    });
  });

  describe('popChange', () => {
    it('retrieves a change by ID and removes it', () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

      tracker._add({ foo: ['=', 2] });
      tracker._send(() => null);
      tracker._add({ bar: ['=', 3] });
      tracker._send(() => null);

      const change1 = tracker._popChange(1);
      expect(change1._localChange?._change).toEqual({ foo: ['=', 2] });

      const local = tracker._computeLocal({});
      expect(local).toEqual({ bar: 3 }); // foo=2 change has gone

      const change2 = tracker._popChange(1);
      expect(change2._localChange).isNull(); // change is no-longer available
    });

    it('returns isFirst if the change is the first in the list', () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

      tracker._add({ foo: ['=', 2] });
      tracker._send(() => null);
      tracker._add({ foo: ['=', 3] });
      tracker._send(() => null);
      tracker._add({ foo: ['=', 4] });
      tracker._send(() => null);

      expect(tracker._popChange(2)._isFirst).isFalse();
      expect(tracker._popChange(1)._isFirst).isTrue();
    });

    it('returns null if the change is not found', () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

      tracker._add({ foo: ['=', 2] });
      tracker._send(() => null);

      const change = tracker._popChange(100);
      expect(change._localChange).isNull();
      expect(change._isFirst).isFalse();
    });
  });

  describe('addCallback', () => {
    it('registers a callback to invoke when the latest item is synced', async () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

      const resolve = mock();
      const reject = mock();
      tracker._add({ foo: ['=', 2] });
      tracker._addCallback({ foo: 1 }, resolve, reject);

      await Promise.resolve();
      expect(resolve).not(toHaveBeenCalled());
      expect(reject).not(toHaveBeenCalled());

      tracker._send(() => null);
      const change = tracker._popChange(1);
      expect(change._localChange?._resolve).toContain(equals(resolve));
      expect(change._localChange?._reject).toContain(equals(reject));
    });

    it('invokes the success callback on the next tick if no changes are queued', async () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

      const resolve = mock();
      const reject = mock();
      tracker._addCallback({ foo: 1 }, resolve, reject);

      expect(resolve).not(toHaveBeenCalled());
      await Promise.resolve();
      expect(resolve).toHaveBeenCalledWith({ foo: 1 });
      expect(reject).not(toHaveBeenCalled());
    });

    it('does nothing if neither resolve nor reject are given', async () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

      tracker._add({ foo: ['=', 2] });
      tracker._addCallback({ foo: 1 }, undefined, undefined);
      tracker._add({ bar: ['=', 3] });

      // events are still combined
      const sent = makeJSONCaptor();
      tracker._send(sent.captor);
      expect(sent.captured).toEqual([{ id: 1, change: { foo: ['=', 2], bar: ['=', 3] } }]);
    });
  });

  describe('send', () => {
    it('combines multiple items', () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

      tracker._add({ foo: ['=', 2] });
      tracker._add({ bar: ['=', 3] });

      const sent = makeJSONCaptor();
      tracker._send(sent.captor);
      expect(sent.captured).toEqual([{ id: 1, change: { foo: ['=', 2], bar: ['=', 3] } }]);
    });

    it('does not combine items with callbacks', () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

      tracker._add({ foo: ['=', 2] });
      tracker._addCallback(null, () => null, undefined);
      tracker._add({ bar: ['=', 3] });

      const sent = makeJSONCaptor();
      tracker._send(sent.captor);
      expect(sent.captured).toEqual([
        { id: 1, change: { foo: ['=', 2] } },
        { id: 2, change: { bar: ['=', 3] } },
      ]);
    });

    it('does not combine or re-send items which have been sent', () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

      tracker._add({ foo: ['=', 2] });
      tracker._send(() => null);
      tracker._add({ bar: ['=', 3] });

      const sent = makeJSONCaptor();
      tracker._send(sent.captor);
      expect(sent.captured).toEqual([{ id: 2, change: { bar: ['=', 3] } }]);

      const change = tracker._popChange(1);
      expect(change._localChange?._change).toEqual({ foo: ['=', 2] }); // unchanged
    });

    it('combines all available batches', () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);

      tracker._add({ a: ['=', 1] });
      tracker._add({ b: ['=', 1] });

      tracker._add({ c: ['=', 1] });
      tracker._addCallback(null, () => null, undefined);

      tracker._add({ d: ['=', 1] });
      tracker._add({ e: ['=', 1] });
      tracker._add({ f: ['=', 1] });

      tracker._add({ g: ['=', 1] });
      tracker._addCallback(null, () => null, undefined);

      const sent = makeJSONCaptor();
      tracker._send(sent.captor);
      expect(sent.captured).toEqual([
        { id: 1, change: { a: ['=', 1], b: ['=', 1] } },
        { id: 2, change: { c: ['=', 1] } },
        { id: 3, change: { d: ['=', 1], e: ['=', 1], f: ['=', 1] } },
        { id: 4, change: { g: ['=', 1] } },
      ]);
    });
  });

  describe('requeue', () => {
    it('marks items which have already been sent for re-sending', () => {
      const tracker = new LocalChangeTracker(context, AT_LEAST_ONCE);
      const resent = makeJSONCaptor();

      tracker._add({ foo: ['=', 2] });
      tracker._add({ bar: ['=', 3] });
      tracker._send(() => null);
      tracker._add({ baz: ['=', 4] });
      tracker._requeue({});
      tracker._send(resent.captor);

      expect(resent.captured).toEqual([
        { id: 2, change: { foo: ['=', 2], bar: ['=', 3], baz: ['=', 4] } },
      ]);
    });

    it('uses the given strategy to decide what to resend', () => {
      const tracker = new LocalChangeTracker(context, AT_MOST_ONCE);
      const resent = makeJSONCaptor();

      tracker._add({ foo: ['=', 2] });
      tracker._add({ bar: ['=', 3] });
      tracker._send(() => null);
      tracker._add({ baz: ['=', 4] });
      tracker._requeue({});
      tracker._send(resent.captor);

      expect(resent.captured).toEqual([{ id: 2, change: { baz: ['=', 4] } }]);
    });

    it('invokes the callback for messages which are dropped', () => {
      const tracker = new LocalChangeTracker(context, AT_MOST_ONCE);

      let capturedMessage = '';
      tracker._add({ foo: ['=', 2] });
      tracker._addCallback(
        {},
        () => fail(),
        (message) => {
          capturedMessage = message;
        },
      );
      tracker._send(() => null);
      tracker._requeue({});

      expect(capturedMessage).toEqual('message possibly lost');
    });
  });
});

function makeJSONCaptor() {
  const captured: unknown[] = [];
  return {
    captor: (v: string) => captured.push(JSON.parse(v)),
    captured,
  };
}
