import context, { type Spec } from 'json-immutability-helper';
import { Broadcaster, type ChangeInfo, type Subscription } from './Broadcaster';
import { InMemoryModel } from './model/InMemoryModel';

describe('Broadcaster', () => {
  it('notifies subscribers of updates', async () => {
    const { model, broadcaster, subscribe } = setup(validateTestT);
    const changeListener = mock<ChangeListenerT>();

    model.set('a', { foo: 'v1' });
    const subscription = await subscribe<number>('a');
    subscription.listen(changeListener);

    await broadcaster.update('a', { foo: ['=', 'v2'] });

    expect(changeListener).toHaveBeenCalledWith({ change: { foo: ['=', 'v2'] } }, undefined);

    await subscription.close();
  });

  it('rejects subscriptions to unknown keys', async () => {
    const { broadcaster } = setup(validateTestT);
    const subscription = await broadcaster.subscribe('nope');
    expect(subscription).toEqual(null);
  });

  it('persists changes to the backing storage', async () => {
    const { model, broadcaster } = setup(validateTestT);
    model.set('a', { foo: 'v1' });
    await broadcaster.update('a', { foo: ['=', 'v2'] });

    expect(model.get('a')).toEqual({ foo: 'v2' });
  });

  it('provides an initial state to new subscribers', async () => {
    const { model, subscribe } = setup(validateTestT);

    model.set('a', { foo: 'v1' });
    const subscription = await subscribe('a');

    expect(subscription.getInitialData()).toEqual({ foo: 'v1' });

    subscription.listen(() => null);
    // after listening, initial data is purged to allow GC cleanup
    expect(() => subscription.getInitialData()).toThrow();

    await subscription.close();
  });

  it('shares changes between clients (but not metadata)', async () => {
    const { model, subscribe } = setup(validateTestT);
    model.set('a', { foo: 'v1' });

    const changeListener1 = mock<ChangeListenerT>();
    const subscription1 = await subscribe<number>('a');
    subscription1.listen(changeListener1);

    const changeListener2 = mock<ChangeListenerT>();
    const subscription2 = await subscribe<number>('a');
    subscription2.listen(changeListener2);

    await subscription1.send({ foo: ['=', 'v2'] }, 20);

    expect(changeListener1).toHaveBeenCalledWith({ change: { foo: ['=', 'v2'] } }, 20);
    expect(changeListener2).toHaveBeenCalledWith({ change: { foo: ['=', 'v2'] } }, undefined);

    await subscription1.close();
    await subscription2.close();
  });

  it('queues events received after loading initial data until listen is called', async () => {
    const { model, broadcaster, subscribe } = setup(validateTestT);
    model.set('a', { foo: 'v1' });

    await broadcaster.update('a', { foo: ['=', 'v2'] }); // not queued

    const changeListener = mock<ChangeListenerT>();
    const subscription = await subscribe<number>('a');

    await broadcaster.update('a', { foo: ['=', 'v3'] }); // queued

    subscription.listen(changeListener);
    expect(changeListener).toHaveBeenCalled({ times: 1 });
    expect(changeListener).toHaveBeenCalledWith({ change: { foo: ['=', 'v3'] } }, undefined);

    await subscription.close();
  });

  it('stops sending changes when the subscription is closed', async () => {
    const { model, subscribe } = setup(validateTestT);
    model.set('a', { foo: 'v1' });

    const changeListener1 = mock<ChangeListenerT>();
    const subscription1 = await subscribe<number>('a');
    subscription1.listen(changeListener1);

    const changeListener2 = mock<ChangeListenerT>();
    const subscription2 = await subscribe<number>('a');
    subscription2.listen(changeListener2);

    await subscription1.close();

    await subscription2.send({ foo: ['=', 'v2'] }, 20);
    expect(changeListener1).not(toHaveBeenCalled());
    expect(changeListener2).toHaveBeenCalled();

    await subscription2.close();
  });

  it('rejects invalid changes and does not notify others', async () => {
    const { model, subscribe } = setup(validateTestT);
    model.set('a', { foo: 'v1' });

    const changeListener1 = mock<ChangeListenerT>();
    const subscription1 = await subscribe<number>('a');
    subscription1.listen(changeListener1);

    const changeListener2 = mock<ChangeListenerT>();
    const subscription2 = await subscribe<number>('a');
    subscription2.listen(changeListener2);

    const invalidType = 'eek' as unknown as TestT;
    await subscription1.send(['=', invalidType], 20);

    expect(changeListener1).toHaveBeenCalledWith({ error: 'should be an object' }, 20);
    expect(changeListener2).not(toHaveBeenCalled());

    await subscription1.close();
    await subscription2.close();
  });
});

type ChangeListenerT = (message: ChangeInfo<Spec<TestT>>, meta?: number) => void;

interface TestT {
  foo: string;
}

function validateTestT(x: unknown): TestT {
  if (typeof x !== 'object' || !x) {
    throw new Error('should be an object');
  }
  if (Object.keys(x).length !== 1) {
    throw new Error('should have one property');
  }
  const test = x as TestT;
  if (typeof test.foo !== 'string') {
    throw new Error('should have foo');
  }
  return test;
}

function setup<T>(validator: (x: unknown) => T): {
  model: InMemoryModel<string, T>;
  broadcaster: Broadcaster<T, Spec<T>>;
  subscribe<MetaT>(id: string): Promise<Subscription<T, Spec<T>, MetaT>>;
} {
  const model = new InMemoryModel<string, T>(validator);
  const broadcaster = new Broadcaster<T, Spec<T>>(model, context);

  return {
    model,
    broadcaster,
    async subscribe<MetaT>(id: string) {
      const subscription = await broadcaster.subscribe<MetaT>(id);
      if (!subscription) {
        throw new Error('Failed to subscribe');
      }
      return subscription;
    },
  };
}
