import context, { type Spec } from 'json-immutability-helper';
import type { Request } from 'express';
import { WebSocketExpress } from 'websocket-express';
import { WebSocket } from 'ws';
import 'lean-test';

import { closeServer, runLocalServer, getAddress } from '../test-helpers/serverRunner';
import { BreakableTcpProxy } from '../test-helpers/BreakableTcpProxy';
import { sleep } from '../test-helpers/sleep';
import { Sentinel } from '../test-helpers/Sentinel';
import {
  Broadcaster,
  WebsocketHandlerFactory,
  InMemoryModel,
  ReadWrite,
  ReadOnly,
  type ChangeInfo,
} from '../backend';
import {
  AT_LEAST_ONCE,
  AT_MOST_ONCE,
  SharedReducer,
  type DispatchSpec,
  type SharedReducerOptions,
} from '../frontend';

if (!global.WebSocket) {
  (global as any).WebSocket = WebSocket;
}

interface Context {
  broadcaster: Broadcaster<TestT, Spec<TestT>>;
  peekState(id: string): Promise<TestT | null>;
  getReducer(
    path: string,
    warningHandler: (warning: string) => void,
    changeHandler?: (state: TestT) => void,
    options?: SharedReducerOptions<TestT, Spec<TestT>>,
  ): SharedReducer<TestT, Spec<TestT>>;
  proxy: BreakableTcpProxy;
}

describe('e2e', () => {
  const CONTEXT = beforeEach<Context>(async ({ setParameter }) => {
    const model = new InMemoryModel<string, TestT>();
    const broadcaster = new Broadcaster<TestT, Spec<TestT>>(model, context);

    const app = new WebSocketExpress();
    const handlerFactory = new WebsocketHandlerFactory(broadcaster);
    app.ws(
      '/:id/read',
      handlerFactory.handler(
        (req: Request) => req.params['id'] ?? '',
        () => ReadOnly,
      ),
    );
    app.ws(
      '/:id',
      handlerFactory.handler(
        (req: Request) => req.params['id'] ?? '',
        () => ReadWrite,
      ),
    );

    model.set('a', { foo: 'v1', bar: 10 });
    const server = await runLocalServer(app);
    const proxy = new BreakableTcpProxy(server.address());
    await proxy.listen(0, 'localhost');
    const host = getAddress(proxy.server, 'ws');
    const reducers: SharedReducer<any, any>[] = [];

    setParameter({
      broadcaster,
      peekState: async (id) => {
        const s = await broadcaster.subscribe(id);
        if (!s) {
          return null;
        }
        try {
          return s.getInitialData();
        } finally {
          await s.close();
        }
      },
      getReducer: (path, warningHandler, changeHandler, options) => {
        const r = new SharedReducer<TestT, Spec<TestT>>(
          context,
          () => ({ url: host + path }),
          options,
        );
        r.addEventListener('warning', (e) => warningHandler(e.detail.message));
        if (changeHandler) {
          r.addStateListener(changeHandler);
        }
        reducers.push(r);
        return r;
      },
      proxy,
    });

    return async () => {
      reducers.forEach((r) => r.close());
      await closeServer(server);
      await proxy.close();
    };
  });

  describe('one client', () => {
    it('sends initial state from server to client', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const initialState = await new Promise((resolve) => getReducer('/a', fail, resolve));
      expect(initialState).toEqual({ foo: 'v1', bar: 10 });
    });

    it('invokes synchronize callbacks when state is first retrieved', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      const state = await reducer.dispatch.sync();
      expect(state).toEqual({ foo: 'v1', bar: 10 });
    });

    it('reflects state changes back to the sender', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.dispatch.sync();

      const state = await reducer.dispatch.sync([{ foo: ['=', 'v2'] }]);

      expect(state).toEqual({ foo: 'v2', bar: 10 });
    });

    it('accepts chained specs', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.dispatch.sync();

      reducer.dispatch([{ bar: ['=', 1] }, { bar: ['+', 2] }, { bar: ['+', 3] }]);
      reducer.dispatch([{ bar: ['+', 5] }]);
      const state = await reducer.dispatch.sync();

      expect(state.bar).toEqual(11);
    });

    it('accepts spec generator functions', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.dispatch.sync();

      reducer.dispatch([() => [{ bar: ['=', 2] }]]);
      const state = await reducer.dispatch.sync();

      expect(state.bar).toEqual(2);
    });

    it('provides current state to state generator functions', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.dispatch.sync();

      reducer.dispatch([{ bar: ['=', 5] }]);
      reducer.dispatch([(state) => [{ bar: ['=', state.bar * 3] }]]);
      const state = await reducer.dispatch.sync();

      expect(state.bar).toEqual(15);
    });

    it('provides current state to state generator functions when chaining', async ({
      getTyped,
    }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.dispatch.sync();

      reducer.dispatch([{ bar: ['=', 5] }, (state) => [{ bar: ['=', state.bar * 3] }]]);
      const state = await reducer.dispatch.sync();

      expect(state.bar).toEqual(15);
    });

    it('passes state from previous generators to subsequent generators', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.dispatch.sync();

      reducer.dispatch([
        { bar: ['=', 5] },
        (state) => [{ bar: ['=', state.bar * 3] }],
        (state) => [{ bar: ['=', state.bar + 2] }],
        { bar: ['+', 1] },
        (state) => [{ bar: ['=', state.bar * 2] }],
      ]);
      const state = await reducer.dispatch.sync();

      expect(state.bar).toEqual(36);
    });

    it('queues changes until the initial server state is received', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);

      const generator = mock(
        (state: TestT): DispatchSpec<TestT, Spec<TestT>> => [{ bar: ['=', state.bar * 3] }],
      );
      reducer.dispatch([generator]);

      expect(generator).not(toHaveBeenCalled());

      const state = await reducer.dispatch.sync();
      expect(state.bar).toEqual(30);

      expect(generator).toHaveBeenCalledWith({ foo: 'v1', bar: 10 });
    });

    it('pushes external state changes', async ({ getTyped }) => {
      const { broadcaster, getReducer } = getTyped(CONTEXT);
      const stateSentinel = new Sentinel<TestT>();
      let waiting = false;
      const reducer = getReducer('/a', fail, (v) => {
        if (waiting) {
          stateSentinel.resolve(v);
        }
      });
      await reducer.dispatch.sync();

      waiting = true;
      await broadcaster.update('a', { foo: ['=', 'v2'] });
      expect(await stateSentinel.await()).toEqual({ foo: 'v2', bar: 10 });
    });

    it('merges external state changes', async ({ getTyped }) => {
      const { broadcaster, getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.dispatch.sync();

      await broadcaster.update('a', { foo: ['=', 'v2'] });
      reducer.dispatch([{ bar: ['=', 11] }]);
      const state = await reducer.dispatch.sync();

      expect(state).toEqual({ foo: 'v2', bar: 11 });
    });

    it('maintains local state changes until the server syncs', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.dispatch.sync();

      reducer.dispatch([{ foo: ['=', 'v2'] }]);
      expect(reducer.getState()).toEqual({ foo: 'v2', bar: 10 });
    });

    it('applies local state changes on top of the server state', async ({ getTyped }) => {
      const { broadcaster, getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.dispatch.sync();

      await broadcaster.update('a', { bar: ['=', 20] });

      reducer.dispatch([{ bar: ['+', 5] }]);
      expect(reducer.getState()!.bar).toEqual(15); // not synced with server yet

      await reducer.dispatch.sync();
      expect(reducer.getState()!.bar).toEqual(25); // now synced, local change applies on top
    });

    it('reconnects and resends changes if the connection is lost', async ({ getTyped }) => {
      const { getReducer, broadcaster, peekState, proxy } = getTyped(CONTEXT);

      const specs: ChangeInfo<Spec<TestT>>[] = [];
      const s = await broadcaster.subscribe('a');
      if (!s) {
        return fail();
      }
      s.listen((s) => specs.push(s));

      const reducer = getReducer('/a', fail, () => null, { deliveryStrategy: AT_LEAST_ONCE });
      reducer.dispatch([['=', { foo: 'while online', bar: 1 }]]);
      expect(await reducer.dispatch.sync()).toEqual({ foo: 'while online', bar: 1 });
      expect(await peekState('a')).toEqual({ foo: 'while online', bar: 1 });

      proxy.pullWire();
      reducer.dispatch([{ bar: ['=', 2] }]); // will try to send before realising connection is gone
      await sleep(10);
      reducer.dispatch([{ foo: ['=', 'while offline'] }]); // connection already gone

      await sleep(30);

      expect(reducer.getState()).toEqual({ foo: 'while offline', bar: 2 });
      expect(await peekState('a')).toEqual({ foo: 'while online', bar: 1 });
      expect(specs).toEqual([{ change: ['=', { foo: 'while online', bar: 1 }] }]);

      proxy.resume();
      expect(await reducer.dispatch.sync()).toEqual({ foo: 'while offline', bar: 2 }); // should auto-reconnect

      expect(await peekState('a')).toEqual({ foo: 'while offline', bar: 2 }); // should re-send missed state changes
      expect(specs).toEqual([
        { change: ['=', { foo: 'while online', bar: 1 }] },
        { change: { bar: ['=', 2] } },
        { change: { foo: ['=', 'while offline'] } },
      ]);

      s.close();
    });

    it('AT_MOST_ONCE discards changes which may have already been received', async ({
      getTyped,
    }) => {
      const { getReducer, broadcaster, peekState, proxy } = getTyped(CONTEXT);

      const specs: ChangeInfo<Spec<TestT>>[] = [];
      const s = await broadcaster.subscribe('a');
      if (!s) {
        return fail();
      }
      s.listen((s) => specs.push(s));

      const reducer = getReducer('/a', fail, () => null, { deliveryStrategy: AT_MOST_ONCE });
      reducer.dispatch([['=', { foo: 'while online', bar: 1 }]]);
      expect(await reducer.dispatch.sync()).toEqual({ foo: 'while online', bar: 1 });
      expect(await peekState('a')).toEqual({ foo: 'while online', bar: 1 });

      proxy.pullWire();
      reducer.dispatch([{ bar: ['=', 2] }]); // will try to send before realising connection is gone
      await sleep(10);
      reducer.dispatch([{ foo: ['=', 'while offline'] }]); // connection already gone

      await sleep(10);
      proxy.resume();
      expect(await reducer.dispatch.sync()).toEqual({ foo: 'while offline', bar: 1 }); // should auto-reconnect

      expect(await peekState('a')).toEqual({ foo: 'while offline', bar: 1 });
      expect(specs).toEqual([
        { change: ['=', { foo: 'while online', bar: 1 }] },
        // bar=2 change is lost - client does not know if it was received when the wire was pulled
        { change: { foo: ['=', 'while offline'] } },
      ]);

      s.close();
    });
  });

  describe('readonly client rejects changes', () => {
    it('invokes the warning callback', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const warn = new Sentinel<string>();
      const reducer = getReducer('/a/read', warn.resolve);

      reducer.dispatch([{ bar: ['=', 11] }]);

      await expect(warn.await).resolves('API rejected update: Cannot modify data');
    });

    it('rolls back the local change', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a/read', () => null);
      await reducer.dispatch.sync();

      reducer.dispatch([{ bar: ['=', 11] }]);
      expect(reducer.getState()!.bar).toEqual(11); // not synced with server yet

      await expect(() => reducer.dispatch.sync()).toThrow();
      expect(reducer.getState()!.bar).toEqual(10); // now synced, local change reverted
    });

    it('rejects sync promises and sends a warning', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a/read', () => null);
      await reducer.dispatch.sync();

      await expect(reducer.dispatch.sync([{ bar: ['=', 11] }])).toThrow('Cannot modify data');
    });
  });

  describe('two clients', () => {
    it('pushes changes between clients', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer1 = getReducer('/a', fail);
      const reducer2 = getReducer('/a', fail);
      await reducer1.dispatch.sync();
      await reducer2.dispatch.sync();

      await reducer1.dispatch.sync([{ foo: ['=', 'v2'] }]);
      await reducer2.dispatch.sync([{ bar: ['=', 20] }]);

      expect(reducer2.getState()).toEqual({ foo: 'v2', bar: 20 });
    });
  });
});

interface TestT {
  foo: string;
  bar: number;
}
