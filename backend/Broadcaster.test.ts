import context, { type Spec } from 'json-immutability-helper';
import { InMemoryModel } from './model/InMemoryModel';
import type { Permission } from './permission/Permission';
import { ReadWrite } from './permission/ReadWrite';
import { Broadcaster, type ChangeInfo, type EventFilter } from './Broadcaster';

describe('Broadcaster', () => {
  it('notifies subscribers of updates', async () => {
    const { model, broadcaster, subscribe } = setup(validateTestT);
    const changeListener = mock<ChangeListenerT>();

    model.set('a', { foo: 'v1' });
    const subscription = await subscribe<number>('a');
    subscription.listen(changeListener);

    await broadcaster.update('a', { foo: ['=', 'v2'] });

    expect(changeListener).toHaveBeenCalledWith(
      { change: { foo: ['=', 'v2'] }, events: undefined },
      undefined,
    );

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

    await subscription1.send({ foo: ['=', 'v2'] }, [], 20);

    expect(changeListener1).toHaveBeenCalledWith(
      { change: { foo: ['=', 'v2'] }, events: undefined },
      20,
    );
    expect(changeListener2).toHaveBeenCalledWith(
      { change: { foo: ['=', 'v2'] }, events: undefined },
      undefined,
    );

    await subscription1.close();
    await subscription2.close();
  });

  it('shares events between client', async () => {
    const { model, subscribe } = setup(validateTestT);
    model.set('a', { foo: 'v1' });

    const changeListener1 = mock<ChangeListenerT>();
    const subscription1 = await subscribe<number>('a');
    subscription1.listen(changeListener1);

    const changeListener2 = mock<ChangeListenerT>();
    const subscription2 = await subscribe<number>('a');
    subscription2.listen(changeListener2);

    await subscription1.send({ foo: ['=', 'v2'] }, [['foo']], 20);

    expect(changeListener1).toHaveBeenCalledWith(
      { change: { foo: ['=', 'v2'] }, events: [['foo']] },
      20,
    );
    expect(changeListener2).toHaveBeenCalledWith(
      { change: { foo: ['=', 'v2'] }, events: [['foo']] },
      undefined,
    );

    await subscription1.close();
    await subscription2.close();
  });

  it('queues changes received after loading initial data until listen is called', async () => {
    const { model, broadcaster, subscribe } = setup(validateTestT);
    model.set('a', { foo: 'v1' });

    await broadcaster.update('a', { foo: ['=', 'v2'] }); // not queued

    const changeListener = mock<ChangeListenerT>();
    const subscription = await subscribe<number>('a');

    await broadcaster.update('a', { foo: ['=', 'v3'] }); // queued

    subscription.listen(changeListener);
    expect(changeListener).toHaveBeenCalled({ times: 1 });
    expect(changeListener).toHaveBeenCalledWith(
      { change: { foo: ['=', 'v3'] }, events: undefined },
      undefined,
    );

    await subscription.close();
  });

  it('includes events with queued changes', async () => {
    const { model, broadcaster, subscribe } = setup(validateTestT);
    model.set('a', { foo: 'v1' });

    await broadcaster.update('a', { foo: ['=', 'v2'] }, { events: [['before']] }); // not queued

    const changeListener = mock<ChangeListenerT>();
    const subscription = await subscribe<number>('a');

    await broadcaster.update('a', { foo: ['=', 'v3'] }, { events: [['after1']] }); // queued
    await broadcaster.update('a', { foo: ['=', 'v4'] }, { events: [['after2']] }); // queued

    subscription.listen(changeListener);
    expect(changeListener).toHaveBeenCalled({ times: 2 });
    expect(changeListener).toHaveBeenCalledWith(
      { change: { foo: ['=', 'v3'] }, events: [['after1']] },
      undefined,
    );
    expect(changeListener).toHaveBeenCalledWith(
      { change: { foo: ['=', 'v4'] }, events: [['after2']] },
      undefined,
    );

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

    await subscription2.send({ foo: ['=', 'v2'] }, [], 20);
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
    await subscription1.send(['=', invalidType], [], 20);

    expect(changeListener1).toHaveBeenCalledWith({ error: 'should be an object' }, 20);
    expect(changeListener2).not(toHaveBeenCalled());

    await subscription1.close();
    await subscription2.close();
  });

  it('filters events by subscriber', async () => {
    const { model, subscribe } = setup(validateTestT);
    model.set('a', { foo: 'v1' });

    const changeListener1 = mock<ChangeListenerT>();
    const subscription1 = await subscribe<number>('a');
    subscription1.listen(changeListener1);

    const changeListener2 = mock<ChangeListenerT>();
    const subscription2 = await subscribe<number>('a', ReadWrite, (evt) =>
      evt[0].startsWith('ok:'),
    );
    subscription2.listen(changeListener2);

    await subscription1.send({}, [['no:blocked'], ['ok:allowed'], ['ok:also-allowed']]);

    expect(changeListener1).toHaveBeenCalledWith(
      { change: {}, events: [['no:blocked'], ['ok:allowed'], ['ok:also-allowed']] },
      undefined,
    );
    expect(changeListener2).toHaveBeenCalledWith(
      { change: {}, events: [['ok:allowed'], ['ok:also-allowed']] },
      undefined,
    );

    await subscription1.send({}, [['no:still-blocked']]);
    expect(changeListener1).toHaveBeenCalledWith(
      { change: {}, events: [['no:still-blocked']] },
      undefined,
    );
    expect(changeListener2).toHaveBeenCalled({ times: 1 });

    await subscription1.send({ foo: ['=', 'v2'] }, [['no:still-blocked']]);
    expect(changeListener1).toHaveBeenCalledWith(
      { change: { foo: ['=', 'v2'] }, events: [['no:still-blocked']] },
      undefined,
    );
    expect(changeListener2).toHaveBeenCalledWith(
      { change: { foo: ['=', 'v2'] }, events: undefined },
      undefined,
    );

    await subscription2.send({}, [['no:my-own'], ['ok:my-own']]);
    expect(changeListener1).toHaveBeenCalledWith(
      { change: {}, events: [['no:my-own'], ['ok:my-own']] },
      undefined,
    );
    expect(changeListener2).toHaveBeenCalledWith(
      { change: {}, events: [['ok:my-own']] },
      undefined,
    );

    await subscription1.close();
    await subscription2.close();
  });

  it('notifies sender even if all events are filtered out', async () => {
    const { model, subscribe } = setup(validateTestT);
    model.set('a', { foo: 'v1' });

    const changeListener1 = mock<ChangeListenerT>();
    const subscription1 = await subscribe<number>('a');
    subscription1.listen(changeListener1);

    const changeListener2 = mock<ChangeListenerT>();
    const subscription2 = await subscribe<number>('a', ReadWrite, (evt) =>
      evt[0].startsWith('ok:'),
    );
    subscription2.listen(changeListener2);

    await subscription2.send({}, [['no:my-own']]);
    expect(changeListener1).toHaveBeenCalledWith(
      { change: {}, events: [['no:my-own']] },
      undefined,
    );
    expect(changeListener2).toHaveBeenCalledWith({ change: {}, events: undefined }, undefined);

    await subscription1.close();
    await subscription2.close();
  });

  it('notifies sender even if change is a no-op', async () => {
    const { model, subscribe } = setup(validateTestT);
    model.set('a', { foo: 'v1' });

    const changeListener1 = mock<ChangeListenerT>();
    const subscription1 = await subscribe<number>('a');
    subscription1.listen(changeListener1);

    const changeListener2 = mock<ChangeListenerT>();
    const subscription2 = await subscribe<number>('a');
    subscription2.listen(changeListener2);

    await subscription1.send({});
    expect(changeListener1).toHaveBeenCalledWith({ change: {}, events: undefined }, undefined);
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

function setup<T>(validator: (x: unknown) => T) {
  const model = new InMemoryModel<string, T>(validator);
  const broadcaster = new Broadcaster<T, Spec<T>>(model, context);

  return {
    model,
    broadcaster,
    async subscribe<MetaT>(
      id: string,
      permission?: Permission<T, Spec<T>>,
      eventFilter?: EventFilter,
    ) {
      const subscription = await broadcaster.subscribe<MetaT>(id, permission, eventFilter);
      if (!subscription) {
        throw new Error('Failed to subscribe');
      }
      return subscription;
    },
  };
}
