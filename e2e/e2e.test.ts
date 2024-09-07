import context, { type Spec } from 'json-immutability-helper';
import type { Request } from 'express';
import { WebSocketExpress } from 'websocket-express';
import { WebSocket } from 'ws';
import 'lean-test';

import { closeServer, runLocalServer, getAddress } from '../test-helpers/serverRunner';
import { Broadcaster, websocketHandler, InMemoryModel, ReadWrite, ReadOnly } from '../backend';
import { SharedReducer } from '../frontend';

if (!global.WebSocket) {
  (global as any).WebSocket = WebSocket;
}

describe('e2e', () => {
  const CONTEXT = beforeEach<{
    broadcaster: Broadcaster<TestT, Spec<TestT>>;
    getReducer: (
      path: string,
      errorHandler: (error: string) => void,
      warningHandler: (warning: string) => void,
      changeHandler?: (state: TestT) => void,
    ) => SharedReducer<TestT, Spec<TestT>>;
  }>(async ({ setParameter }) => {
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
    const host = getAddress(server, 'ws');
    const reducers: SharedReducer<any, any>[] = [];

    setParameter({
      broadcaster,
      getReducer: (path, errorHandler, warningHandler, changeHandler) => {
        const r = SharedReducer.for(host + path, changeHandler)
          .withReducer<Spec<TestT>>(context)
          .withErrorHandler(errorHandler)
          .withWarningHandler(warningHandler)
          .build();
        reducers.push(r);
        return r;
      },
    });

    return () => {
      reducers.forEach((r) => r.close());
      return closeServer(server);
    };
  });

  describe('one client', () => {
    it('sends initial state from server to client', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const initialState = await new Promise((resolve) => getReducer('/a', fail, fail, resolve));
      expect(initialState).toEqual({ foo: 'v1', bar: 10 });
    });

    it('invokes synchronize callbacks when state is first retrieved', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail, fail);
      const state = await reducer.syncedState();
      expect(state).toEqual({ foo: 'v1', bar: 10 });
    });

    it('reflects state changes back to the sender', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail, fail);
      await reducer.syncedState();

      reducer.dispatch([{ foo: ['=', 'v2'] }]);
      const state = await reducer.syncedState();

      expect(state).toEqual({ foo: 'v2', bar: 10 });
    });

    it('accepts chained specs', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail, fail);
      await reducer.syncedState();

      reducer.dispatch([{ bar: ['=', 1] }, { bar: ['+', 2] }, { bar: ['+', 3] }]);
      reducer.dispatch([{ bar: ['+', 5] }]);
      const state = await reducer.syncedState();

      expect(state.bar).toEqual(11);
    });

    it('accepts spec generator functions', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail, fail);
      await reducer.syncedState();

      reducer.dispatch([() => [{ bar: ['=', 2] }]]);
      const state = await reducer.syncedState();

      expect(state.bar).toEqual(2);
    });

    it('provides current state to state generator functions', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail, fail);
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
      const reducer = getReducer('/a', fail, fail);
      await reducer.syncedState();

      reducer.dispatch([{ bar: ['=', 5] }, (state) => [{ bar: ['=', state.bar * 3] }]]);
      const state = await reducer.syncedState();

      expect(state.bar).toEqual(15);
    });

    it('passes state from previous generators to subsequent generators', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail, fail);
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
        const reducer = getReducer('/a', fail, fail, (state) => {
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
      const reducer = getReducer('/a', fail, fail);
      await reducer.syncedState();

      await broadcaster.update('a', { foo: ['=', 'v2'] });
      reducer.dispatch([{ bar: ['=', 11] }]);
      const state = await reducer.syncedState();

      expect(state).toEqual({ foo: 'v2', bar: 11 });
    });

    it('maintains local state changes until the server syncs', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail, fail);
      await reducer.syncedState();

      reducer.dispatch([{ foo: ['=', 'v2'] }]);
      expect(reducer.getState()).toEqual({ foo: 'v2', bar: 10 });
    });

    it('applies local state changes on top of the server state', async ({ getTyped }) => {
      const { broadcaster, getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a', fail, fail);
      await reducer.syncedState();

      await broadcaster.update('a', { bar: ['=', 20] });

      reducer.dispatch([{ bar: ['+', 5] }]);
      expect(reducer.getState()!.bar).toEqual(15); // not synced with server yet

      await reducer.syncedState();
      expect(reducer.getState()!.bar).toEqual(25); // now synced, local change applies on top
    });
  });

  describe('readonly client', () => {
    it('invokes the warning callback when the server rejects a change', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      await new Promise<void>((resolve) => {
        const reducer = getReducer('/a/read', fail, (warning: string) => {
          expect(warning).toEqual('API rejected update: Cannot modify data');
          resolve();
        });

        reducer.dispatch([{ bar: ['=', 11] }]);
      });
    });

    it('rolls back local change when rejected by server', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a/read', fail, () => null);
      await reducer.syncedState();

      reducer.dispatch([{ bar: ['=', 11] }]);
      expect(reducer.getState()!.bar).toEqual(11); // not synced with server yet

      await expect(() => reducer.syncedState()).toThrow();
      expect(reducer.getState()!.bar).toEqual(10); // now synced, local change reverted
    });

    it('rejects sync promises when rejected by server', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer = getReducer('/a/read', fail, () => null);
      await reducer.syncedState();

      reducer.dispatch([{ bar: ['=', 11] }]);

      await expect(reducer.syncedState()).throws('Cannot modify data');
    });
  });

  describe('two clients', () => {
    it('pushes changes between clients', async ({ getTyped }) => {
      const { getReducer } = getTyped(CONTEXT);
      const reducer1 = getReducer('/a', fail, fail);
      const reducer2 = getReducer('/a', fail, fail);
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
