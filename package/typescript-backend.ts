import type { IncomingMessage } from 'node:http';
import context, { type Spec } from 'json-immutability-helper';
import { WebSocketExpress } from 'websocket-express';
import {
  emitError,
  getPathParameter,
  HTTPError,
  makeAcceptWebSocket,
  Router,
  setSoftCloseHandler,
  type WithPathParameters,
} from 'web-listener';
import { WebSocketServer } from 'ws';
import {
  Broadcaster,
  WebsocketHandlerFactory,
  ReadWrite,
  InMemoryModel,
} from 'shared-reducer/backend';

interface Type {
  foo: string;
}

(async () => {
  const model = new InMemoryModel<string, Type>();
  model.set('a', { foo: 'v1' });
  const broadcaster = new Broadcaster<Type, Spec<Type>>(model, context);

  broadcaster.update('a', { foo: ['=', 'v2'] });

  //@ts-expect-error
  broadcaster.update('a', { foo: ['=', 0] });

  const handlerFactory = new WebsocketHandlerFactory(broadcaster);

  new WebSocketExpress().ws(
    '/:id',
    handlerFactory.handler({
      accessGetter: (req) => ({ id: req.params.id, permission: ReadWrite }),
      acceptWebSocket: (_, res) => res.accept(),
    }),
  );

  const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);
  new Router().ws(
    '/:id',
    handlerFactory.handler({
      accessGetter: (req) => {
        assertType(req)<IncomingMessage & WithPathParameters<{ id: string }>>();
        return { id: getPathParameter(req, 'id'), permission: ReadWrite };
      },
      acceptWebSocket,
      setSoftCloseHandler,
      notFoundError: new HTTPError(404),
      pingInterval: 10000,
      pongTimeout: 15000,
      onConnect: (req) => {
        assertType(req)<IncomingMessage & WithPathParameters<{ id: string }>>();
      },
      onDisconnect: (req, reason, duration) => {
        assertType(req)<IncomingMessage & WithPathParameters<{ id: string }>>();
        assertType(reason)<string>();
        assertType(duration)<number>();
      },
      onError: emitError,
    }),
  );

  const subscription = await broadcaster.subscribe<number>('a');

  if (subscription) {
    const begin: Readonly<Type> = subscription.getInitialData();
    subscription.listen(({ change, error }, meta) => {
      const changeT: Spec<Type> | undefined = change;
      const errorT: string | undefined = error;
      const metaT: number | undefined = meta;

      //@ts-expect-error
      const changeT2: string = change;
      //@ts-expect-error
      const errorT2: number = error;
      //@ts-expect-error
      const metaT2: string = meta;
    });
    await subscription.send(['=', { foo: 'v3' }]);
    // callback provided earlier is invoked

    await subscription.close();
  }
})();

// assertion helper
type Equals<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? [] : ['nope'];
const assertType =
  <Actual>(_: Actual) =>
  <Expected>(..._typesDoNotMatch: Equals<Actual, Expected>) => {};
