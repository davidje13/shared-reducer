import context, { type Spec } from 'json-immutability-helper';
import type { Request } from 'express';
import { WebSocketExpress } from 'websocket-express';
import { WebSocket } from 'ws';
import 'lean-test';

import { closeServer, runLocalServer, getAddress } from '../test-helpers/serverRunner';
import { BreakableTcpProxy } from '../test-helpers/BreakableTcpProxy';
import {
  Broadcaster,
  websocketHandler,
  InMemoryModel,
  ReadWrite,
  ReadOnly,
  type ChangeInfo,
} from '../backend';
import { AT_LEAST_ONCE, AT_MOST_ONCE, SharedReducer, type SharedReducerOptions } from '../frontend';

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
    const handler = websocketHandler(broadcaster);
    app.ws(
      '/:id/read',
      handler(
        (req: Request) => req.params['id'] ?? '',
        () => ReadOnly,
      ),
    );
    app.ws(
      '/:id',
      handler(
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
        r.addEventListener('warning', (e) =>
          warningHandler(((e as CustomEvent).detail as Error).message),
        );
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
      const state = await reducer.syncedState();
      expect(state).toEqual({ foo: 'v1', bar: 10 });
    });

    it('reflects state changes back to the sender', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.syncedState();

      reducer.dispatch([{ foo: ['=', 'v2'] }]);
      const state = await reducer.syncedState();

      expect(state).toEqual({ foo: 'v2', bar: 10 });
    });

    it('accepts chained specs', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.syncedState();

      reducer.dispatch([{ bar: ['=', 1] }, { bar: ['+', 2] }, { bar: ['+', 3] }]);
      reducer.dispatch([{ bar: ['+', 5] }]);
      const state = await reducer.syncedState();

      expect(state.bar).toEqual(11);
    });

    it('accepts spec generator functions', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.syncedState();

      reducer.dispatch([() => [{ bar: ['=', 2] }]]);
      const state = await reducer.syncedState();

      expect(state.bar).toEqual(2);
    });

    it('provides current state to state generator functions', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.syncedState();

      reducer.dispatch([{ bar: ['=', 5] }]);
      reducer.dispatch([(state) => [{ bar: ['=', state.bar * 3] }]]);
      const state = await reducer.syncedState();

      expect(state.bar).toEqual(15);
    });

    it('provides current state to state generator functions when chaining', async ({
      getTyped,
    }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.syncedState();

      reducer.dispatch([{ bar: ['=', 5] }, (state) => [{ bar: ['=', state.bar * 3] }]]);
      const state = await reducer.syncedState();

      expect(state.bar).toEqual(15);
    });

    it('passes state from previous generators to subsequent generators', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.syncedState();

      reducer.dispatch([
        { bar: ['=', 5] },
        (state) => [{ bar: ['=', state.bar * 3] }],
        (state) => [{ bar: ['=', state.bar + 2] }],
        { bar: ['+', 1] },
        (state) => [{ bar: ['=', state.bar * 2] }],
      ]);
      const state = await reducer.syncedState();

      expect(state.bar).toEqual(36);
    });

    it('pushes external state changes', async ({ getTyped }) => {
      const { broadcaster, getReducer } = getTyped(CONTEXT);
      const syncedState = await new Promise((resolve) => {
        let waiting = false;
        const reducer = getReducer('/a', fail, (state) => {
          if (waiting) {
            resolve(state);
          }
        });

        reducer.syncedState().then(() => {
          waiting = true;
          return broadcaster.update('a', { foo: ['=', 'v2'] });
        });
      });
      expect(syncedState).toEqual({ foo: 'v2', bar: 10 });
    });

    it('merges external state changes', async ({ getTyped }) => {
      const { broadcaster, getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.syncedState();

      await broadcaster.update('a', { foo: ['=', 'v2'] });
      reducer.dispatch([{ bar: ['=', 11] }]);
      const state = await reducer.syncedState();

      expect(state).toEqual({ foo: 'v2', bar: 11 });
    });

    it('maintains local state changes until the server syncs', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.syncedState();

      reducer.dispatch([{ foo: ['=', 'v2'] }]);
      expect(reducer.getState()).toEqual({ foo: 'v2', bar: 10 });
    });

    it('applies local state changes on top of the server state', async ({ getTyped }) => {
      const { broadcaster, getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail);
      await reducer.syncedState();

      await broadcaster.update('a', { bar: ['=', 20] });

      reducer.dispatch([{ bar: ['+', 5] }]);
      expect(reducer.getState()!.bar).toEqual(15); // not synced with server yet

      await reducer.syncedState();
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
      expect(await reducer.syncedState()).toEqual({ foo: 'while online', bar: 1 });
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
      expect(await reducer.syncedState()).toEqual({ foo: 'while offline', bar: 2 }); // should auto-reconnect

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
      expect(await reducer.syncedState()).toEqual({ foo: 'while online', bar: 1 });
      expect(await peekState('a')).toEqual({ foo: 'while online', bar: 1 });

      proxy.pullWire();
      reducer.dispatch([{ bar: ['=', 2] }]); // will try to send before realising connection is gone
      await sleep(10);
      reducer.dispatch([{ foo: ['=', 'while offline'] }]); // connection already gone

      await sleep(10);
      proxy.resume();
      expect(await reducer.syncedState()).toEqual({ foo: 'while offline', bar: 1 }); // should auto-reconnect

      expect(await peekState('a')).toEqual({ foo: 'while offline', bar: 1 });
      expect(specs).toEqual([
        { change: ['=', { foo: 'while online', bar: 1 }] },
        // bar=2 change is lost - client does not know if it was received when the wire was pulled
        { change: { foo: ['=', 'while offline'] } },
      ]);

      s.close();
    });
  });

  describe('readonly client', () => {
    it('invokes the warning callback when the server rejects a change', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      await new Promise<void>((resolve) => {
        const reducer = getReducer('/a/read', (warning: string) => {
          expect(warning).toEqual('API rejected update: Cannot modify data');
          resolve();
        });

        reducer.dispatch([{ bar: ['=', 11] }]);
      });
    });

    it('rolls back local change when rejected by server', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a/read', () => null);
      await reducer.syncedState();

      reducer.dispatch([{ bar: ['=', 11] }]);
      expect(reducer.getState()!.bar).toEqual(11); // not synced with server yet

      await expect(() => reducer.syncedState()).toThrow();
      expect(reducer.getState()!.bar).toEqual(10); // now synced, local change reverted
    });

    it('rejects sync promises when rejected by server', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a/read', () => null);
      await reducer.syncedState();

      reducer.dispatch([{ bar: ['=', 11] }]);

      await expect(reducer.syncedState()).throws('Cannot modify data');
    });
  });

  describe('two clients', () => {
    it('pushes changes between clients', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer1 = getReducer('/a', fail);
      const reducer2 = getReducer('/a', fail);
      await reducer1.syncedState();
      await reducer2.syncedState();

      reducer1.dispatch([{ foo: ['=', 'v2'] }]);
      await reducer1.syncedState();
      reducer2.dispatch([{ bar: ['=', 20] }]);
      await reducer2.syncedState();

      expect(reducer2.getState()).toEqual({ foo: 'v2', bar: 20 });
    });
  });
});

interface TestT {
  foo: string;
  bar: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
