import type { Server } from 'node:net';
import context, { type Spec } from 'json-immutability-helper';
import type { Application, Request } from 'express';
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
  type Permission,
} from '../backend';
import {
  AT_LEAST_ONCE,
  AT_MOST_ONCE,
  exponentialDelay,
  OnlineScheduler,
  SharedReducer,
  type DispatchSpec,
  type SharedReducerOptions,
} from '../frontend';

if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket as typeof globalThis.WebSocket;
}

describe('e2e', () => {
  describe('one client', () => {
    it('sends initial state from server to client', async ({ getTyped }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');
      const initialState = await new Promise((resolve) => reducer.addStateListener(resolve));
      expect(initialState).toEqual({ foo: 'v1', bar: 10 });
    });

    it('sends any required authentication before beginning', async ({ getTyped }) => {
      const runner = getTyped(RUNNER);
      const model = new InMemoryModel<string, TestT>();
      model.set('a', { foo: 'v1', bar: 10 });
      const broadcaster = new Broadcaster<TestT, Spec<TestT>>(model, context);
      const handlerFactory = new WebsocketHandlerFactory(broadcaster);
      let capturedToken = '';
      const app = new WebSocketExpress();
      app.ws(
        '/:id',
        WebSocketExpress.requireBearerAuth(
          () => '',
          (token) => {
            capturedToken = token;
            return {};
          },
        ),
        handlerFactory.handler(
          (req: Request) => req.params['id'] ?? '',
          () => ReadWrite,
        ),
      );
      const server = await runner.runServer(app);

      const reducer = runner.getReducer<TestT>(server, '/a', { token: 'my-token' });

      const initialState = await new Promise((resolve) => reducer.addStateListener(resolve));
      expect(initialState).toEqual({ foo: 'v1', bar: 10 });
      expect(capturedToken).toEqual('my-token');
    });

    it('invokes synchronize callbacks when state is first retrieved', async ({ getTyped }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');
      const state = await reducer.dispatch.sync();
      expect(state).toEqual({ foo: 'v1', bar: 10 });
    });

    it('reflects state changes back to the sender', async ({ getTyped }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');
      await reducer.dispatch.sync();

      const state = await reducer.dispatch.sync([{ foo: ['=', 'v2'] }]);

      expect(state).toEqual({ foo: 'v2', bar: 10 });
    });

    it('accepts chained specs', async ({ getTyped }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');
      await reducer.dispatch.sync();

      reducer.dispatch([{ bar: ['=', 1] }, { bar: ['+', 2] }, { bar: ['+', 3] }]);
      reducer.dispatch([{ bar: ['+', 5] }]);
      const state = await reducer.dispatch.sync();

      expect(state.bar).toEqual(11);
    });

    it('accepts spec generator functions', async ({ getTyped }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');
      await reducer.dispatch.sync();

      reducer.dispatch([() => [{ bar: ['=', 2] }]]);
      const state = await reducer.dispatch.sync();

      expect(state.bar).toEqual(2);
    });

    it('provides current state to state generator functions', async ({ getTyped }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');
      await reducer.dispatch.sync();

      reducer.dispatch([{ bar: ['=', 5] }]);
      reducer.dispatch([(state) => [{ bar: ['=', state.bar * 3] }]]);
      const state = await reducer.dispatch.sync();

      expect(state.bar).toEqual(15);
    });

    it('provides current state to state generator functions when chaining', async ({
      getTyped,
    }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');
      await reducer.dispatch.sync();

      reducer.dispatch([{ bar: ['=', 5] }, (state) => [{ bar: ['=', state.bar * 3] }]]);
      const state = await reducer.dispatch.sync();

      expect(state.bar).toEqual(15);
    });

    it('passes state from previous generators to subsequent generators', async ({ getTyped }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');
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
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');

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
      const { broadcaster, server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');
      const stateSentinel = new Sentinel<TestT>();
      let waiting = false;
      reducer.addStateListener((v) => {
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
      const { broadcaster, server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');
      await reducer.dispatch.sync();

      await broadcaster.update('a', { foo: ['=', 'v2'] });
      reducer.dispatch([{ bar: ['=', 11] }]);
      const state = await reducer.dispatch.sync();

      expect(state).toEqual({ foo: 'v2', bar: 11 });
    });

    it('maintains local state changes until the server syncs', async ({ getTyped }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');
      await reducer.dispatch.sync();

      reducer.dispatch([{ foo: ['=', 'v2'] }]);
      expect(reducer.getState()).toEqual({ foo: 'v2', bar: 10 });
    });

    it('applies local state changes on top of the server state', async ({ getTyped }) => {
      const { broadcaster, server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer = getReducer<TestT>(server, '/a');
      await reducer.dispatch.sync();

      await broadcaster.update('a', { bar: ['=', 20] });

      reducer.dispatch([{ bar: ['+', 5] }]);
      expect(reducer.getState()!.bar).toEqual(15); // not synced with server yet

      await reducer.dispatch.sync();
      expect(reducer.getState()!.bar).toEqual(25); // now synced, local change applies on top
    });

    it('reconnects and resends changes if the connection is lost', async ({ getTyped }) => {
      const { broadcaster, server, runProxy, getReducer } =
        await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const proxy = await runProxy(server);

      const specs: ChangeInfo<Spec<TestT>>[] = [];
      const s = await broadcaster.subscribe('a');
      if (!s) {
        return fail();
      }
      s.listen((s) => specs.push(s));

      const reducer = getReducer<TestT>(proxy.server, '/a', {
        warningHandler: () => null,
        deliveryStrategy: AT_LEAST_ONCE,
        scheduler: new OnlineScheduler(rapidRetry, 1000),
      });
      reducer.dispatch([['=', { foo: 'while online', bar: 1 }]]);
      expect(await reducer.dispatch.sync()).toEqual({ foo: 'while online', bar: 1 });
      expect(await peekState(broadcaster, 'a')).toEqual({ foo: 'while online', bar: 1 });

      proxy.pullWire();
      reducer.dispatch([{ bar: ['=', 2] }]); // will try to send before realising connection is gone
      await sleep(10);
      reducer.dispatch([{ foo: ['=', 'while offline'] }]); // connection already gone

      await sleep(30);

      expect(reducer.getState()).toEqual({ foo: 'while offline', bar: 2 });
      expect(await peekState(broadcaster, 'a')).toEqual({ foo: 'while online', bar: 1 });
      expect(specs).toEqual([{ change: ['=', { foo: 'while online', bar: 1 }] }]);

      proxy.resume();
      expect(await reducer.dispatch.sync()).toEqual({ foo: 'while offline', bar: 2 }); // should auto-reconnect

      expect(await peekState(broadcaster, 'a')).toEqual({ foo: 'while offline', bar: 2 }); // should re-send missed state changes
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
      const { broadcaster, server, runProxy, getReducer } =
        await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const proxy = await runProxy(server);

      const specs: ChangeInfo<Spec<TestT>>[] = [];
      const s = await broadcaster.subscribe('a');
      if (!s) {
        return fail();
      }
      s.listen((s) => specs.push(s));

      const reducer = getReducer<TestT>(proxy.server, '/a', {
        warningHandler: () => null,
        deliveryStrategy: AT_MOST_ONCE,
        scheduler: new OnlineScheduler(rapidRetry, 1000),
      });
      reducer.dispatch([['=', { foo: 'while online', bar: 1 }]]);
      expect(await reducer.dispatch.sync()).toEqual({ foo: 'while online', bar: 1 });
      expect(await peekState(broadcaster, 'a')).toEqual({ foo: 'while online', bar: 1 });

      proxy.pullWire();
      reducer.dispatch([{ bar: ['=', 2] }]); // will try to send before realising connection is gone
      await sleep(10);
      reducer.dispatch([{ foo: ['=', 'while offline'] }]); // connection already gone

      await sleep(10);
      proxy.resume();
      expect(await reducer.dispatch.sync()).toEqual({ foo: 'while offline', bar: 1 }); // should auto-reconnect

      expect(await peekState(broadcaster, 'a')).toEqual({ foo: 'while offline', bar: 1 });
      expect(specs).toEqual([
        { change: ['=', { foo: 'while online', bar: 1 }] },
        // bar=2 change is lost - client does not know if it was received when the wire was pulled
        { change: { foo: ['=', 'while offline'] } },
      ]);

      s.close();
    });

    it('pauses sending after a graceful shutdown message', async ({ getTyped }) => {
      const { broadcaster, server, handlerFactory, getReducer } =
        await getTyped(RUNNER).basicSetup(INITIAL_STATE);

      const reducer = getReducer<TestT>(server, '/a');
      await reducer.dispatch.sync();
      const clientPromise = reducer.dispatch.sync([{ foo: ['=', 'while closing'] }]);
      await sleep(0); // wait for client to send message
      expect(await peekState(broadcaster, 'a')).not(toEqual('while closing'));

      const closePromise = handlerFactory.softClose(1000);
      expect(await clientPromise).toEqual({ foo: 'while closing', bar: 10 });
      expect(await peekState(broadcaster, 'a')).toEqual({ foo: 'while closing', bar: 10 });
      await closePromise;

      reducer.dispatch([{ foo: ['=', 'soft closed'] }]);
      await sleep(10);

      expect(reducer.getState()).toEqual({ foo: 'soft closed', bar: 10 });
      expect(await peekState(broadcaster, 'a')).toEqual({ foo: 'while closing', bar: 10 });
    });
  });

  describe('readonly client rejects changes', () => {
    it('invokes the warning callback', async ({ getTyped }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE, ReadOnly);
      const warn = new Sentinel<string>();
      const reducer = getReducer<TestT>(server, '/a', { warningHandler: warn.resolve });

      reducer.dispatch([{ bar: ['=', 11] }]);

      await expect(warn.await).resolves('API rejected update: Cannot modify data');
    });

    it('rolls back the local change', async ({ getTyped }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE, ReadOnly);
      const reducer = getReducer<TestT>(server, '/a', { warningHandler: () => null });
      await reducer.dispatch.sync();

      reducer.dispatch([{ bar: ['=', 11] }]);
      expect(reducer.getState()!.bar).toEqual(11); // not synced with server yet

      await expect(() => reducer.dispatch.sync()).toThrow();
      expect(reducer.getState()!.bar).toEqual(10); // now synced, local change reverted
    });

    it('rejects sync promises and sends a warning', async ({ getTyped }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE, ReadOnly);
      const reducer = getReducer<TestT>(server, '/a', { warningHandler: () => null });
      await reducer.dispatch.sync();

      await expect(reducer.dispatch.sync([{ bar: ['=', 11] }])).toThrow('Cannot modify data');
    });
  });

  describe('two clients', () => {
    it('pushes changes between clients', async ({ getTyped }) => {
      const { server, getReducer } = await getTyped(RUNNER).basicSetup(INITIAL_STATE);
      const reducer1 = getReducer<TestT>(server, '/a');
      const reducer2 = getReducer<TestT>(server, '/a');
      await reducer1.dispatch.sync();
      await reducer2.dispatch.sync();

      await reducer1.dispatch.sync([{ foo: ['=', 'v2'] }]);
      await reducer2.dispatch.sync([{ bar: ['=', 20] }]);

      expect(reducer2.getState()).toEqual({ foo: 'v2', bar: 20 });
    });
  });

  const RUNNER = beforeEach<Runner>(({ setParameter }) => {
    const reducers: SharedReducer<any, any>[] = [];
    const proxies: BreakableTcpProxy[] = [];
    const servers: Server[] = [];

    const runner: Runner = {
      runServer: async (app: Application) => {
        const server = await runLocalServer(app);
        servers.push(server);
        return server;
      },
      runProxy: async (target: Server) => {
        const proxy = new BreakableTcpProxy(target.address());
        await proxy.listen(0, 'localhost');
        proxies.push(proxy);
        return proxy;
      },
      getReducer: <T>(
        server: Server,
        path: string,
        {
          warningHandler = fail,
          token,
          ...options
        }: SharedReducerOptions<T, Spec<T>> & ReducerOptions = {},
      ) => {
        const host = getAddress(server, 'ws');
        const reducer = new SharedReducer<T, Spec<T>>(
          context,
          () => ({ url: host + path, token }),
          options,
        );
        reducer.addEventListener('warning', (e) => warningHandler(e.detail.message));
        reducers.push(reducer);
        return reducer;
      },

      basicSetup: async <T>(initialState: T, permission = ReadWrite) => {
        const model = new InMemoryModel<string, T>();
        model.set('a', initialState);
        const broadcaster = new Broadcaster<T, Spec<T>>(model, context);
        const handlerFactory = new WebsocketHandlerFactory(broadcaster);
        const app = new WebSocketExpress();
        app.ws(
          '/:id',
          handlerFactory.handler(
            (req: Request) => req.params['id'] ?? '',
            () => permission,
          ),
        );
        const server = await runner.runServer(app);

        return { ...runner, broadcaster, handlerFactory, server };
      },
    };

    setParameter(runner);

    return async () => {
      reducers.forEach((r) => r.close());
      await Promise.all(servers.map(closeServer));
      await Promise.all(proxies.map((p) => p.close()));
    };
  });
});

interface ReducerOptions {
  token?: string;
  warningHandler?: (message: string) => void;
}

interface Runner {
  runServer(app: Application): Promise<Server>;
  runProxy(target: Server): Promise<BreakableTcpProxy>;
  getReducer<T>(
    server: Server,
    path: string,
    options?: SharedReducerOptions<T, Spec<T>> & ReducerOptions,
  ): SharedReducer<T, Spec<T>>;
  basicSetup<T>(
    initialState: T,
    permission?: Permission<T, Spec<T>>,
  ): Promise<
    Runner & {
      broadcaster: Broadcaster<T, Spec<T>>;
      handlerFactory: WebsocketHandlerFactory<T, Spec<T>>;
      server: Server;
    }
  >;
}

interface TestT {
  foo: string;
  bar: number;
}

const rapidRetry = exponentialDelay({ initialDelay: 100, maxDelay: 300 });

const INITIAL_STATE: TestT = { foo: 'v1', bar: 10 };

async function peekState<T>(broadcaster: Broadcaster<T, any>, id: string): Promise<T | null> {
  const s = await broadcaster.subscribe(id);
  if (!s) {
    return null;
  }
  try {
    return s.getInitialData();
  } finally {
    await s.close();
  }
}
