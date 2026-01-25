import type { IncomingMessage } from 'node:http';
import context, { type Spec } from 'json-immutability-helper';
import request from 'superwstest';
import {
  getPathParameter,
  makeAcceptWebSocket,
  makeWebSocketFallbackTokenFetcher,
  requireBearerAuth,
  Router,
  setSoftCloseHandler,
  WebListener,
  type AugmentedServer,
  type UpgradeHandler,
  type WithPathParameters,
} from 'web-listener';
import { WebSocketServer } from 'ws';
import { Sentinel } from '../../test-helpers/Sentinel';
import { BreakableTcpProxy } from '../../test-helpers/BreakableTcpProxy';
import { sleep } from '../../test-helpers/sleep';
import { InMemoryModel } from '../model/InMemoryModel';
import { Broadcaster } from '../Broadcaster';
import { ReadWrite } from '../permission/ReadWrite';
import { ReadOnly } from '../permission/ReadOnly';
import { ReadWriteStruct } from '../permission/ReadWriteStruct';
import { PermissionError, type Permission } from '../permission/Permission';
import { WebsocketHandlerFactory, type WebsocketHandlerOptions } from './WebsocketHandlerFactory';

const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

describe('WebsocketHandlerFactory', () => {
  const SERVER_FACTORY = beforeEach<TestSetup>(async ({ setParameter }) => {
    const router = new Router();
    const server = await new WebListener(router).listen(0, 'localhost');

    setParameter({ router, server });

    return () => server.closeWithTimeout('end of test', 0);
  });

  it('creates a web-listener compatible handler', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    await request(server).ws('/a');
  });

  it('returns the initial state', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    await request(server)
      .ws('/a')
      .expectJson({ init: { foo: 'v1' } });
  });

  it('reflects changes', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    await request(server)
      .ws('/a')
      .expectJson()
      .sendJson({ change: { foo: ['=', 'v2'] } })
      .expectJson({ change: { foo: ['=', 'v2'] } });
  });

  it('reflects events', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    await request(server)
      .ws('/a')
      .expectJson()
      .sendJson({ change: {}, events: [['foo', 1]] })
      .expectJson({ change: {}, events: [['foo', 1]] });
  });

  it('rejects invalid messages', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    await request(server)
      .ws('/a')
      .expectJson()
      .sendText('{invalid}')
      .expectJson((v) => expect(v.error).equals('Invalid JSON'));
  });

  it('handles errors from the idGetter', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    await request(server).ws('/error').expectConnectionError(500);
  });

  it('rejects changes in read-only mode', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY), { permission: ReadOnly });

    await request(server)
      .ws('/a')
      .expectJson()
      .sendJson({ change: { foo: ['=', 'v2'] } })
      .expectJson({ error: 'Cannot modify data' });
  });

  it('rejects changes forbidden by permissions', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY), {
      permission: new ReadWriteStruct(['foo']),
    });

    await request(server)
      .ws('/a')
      .expectJson()
      .sendJson({ change: { foo: ['=', 'v2'] } })
      .expectJson({ error: 'Cannot edit field foo' });
  });

  it('rejects events forbidden by permissions', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY), {
      permission: {
        validateWrite: () => {},
        validateEvent: () => {
          throw new PermissionError('nope');
        },
      },
    });

    await request(server)
      .ws('/a')
      .expectJson()
      .sendJson({ change: { foo: ['=', 'v2'] }, events: [['foo']] })
      .expectJson({ error: 'nope' });
  });

  it('rejects changes forbidden by model', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    await request(server)
      .ws('/a')
      .expectJson()
      .sendJson({ change: { foo: ['=', 'denied'] } })
      .expectJson({ error: 'Test rejection' });
  });

  it('reflects id field if provided', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    await request(server)
      .ws('/a')
      .expectJson()
      .sendJson({ change: { foo: ['=', 'v2'] }, id: 20 })
      .expectJson({ change: { foo: ['=', 'v2'] }, id: 20 });
  });

  it('sends updates to other subscribers without id field', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    const sentinel = new Sentinel();

    await Promise.all([
      request(server)
        .ws('/a')
        .expectJson({ init: { foo: 'v1' } })
        .exec(sentinel.await)
        .sendJson({ change: { foo: ['=', 'v2'] }, id: 20 })
        .expectJson({ change: { foo: ['=', 'v2'] }, id: 20 }),

      request(server)
        .ws('/a')
        .expectJson({ init: { foo: 'v1' } })
        .exec(sentinel.resolve)
        .expectJson({ change: { foo: ['=', 'v2'] } }),
    ]);

    await request(server)
      .ws('/a')
      .expectJson({ init: { foo: 'v2' } });
  });

  it('sends events to other current subscribers', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    const sentinel = new Sentinel();

    await Promise.all([
      request(server)
        .ws('/a')
        .expectJson({ init: { foo: 'v1' } })
        .exec(sentinel.await)
        .sendJson({ change: { foo: ['=', 'v2'] }, events: [['foo', 1]], id: 20 })
        .expectJson({ change: { foo: ['=', 'v2'] }, events: [['foo', 1]], id: 20 }),

      request(server)
        .ws('/a')
        .expectJson({ init: { foo: 'v1' } })
        .exec(sentinel.resolve)
        .expectJson({ change: { foo: ['=', 'v2'] }, events: [['foo', 1]] }),
    ]);

    await request(server)
      .ws('/a')
      .expectJson({ init: { foo: 'v2' } });
  });

  it('sends close message when softClose is called', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));
    const complete = new Sentinel();

    await request(server)
      .ws('/a')
      .expectJson()
      .exec(() => {
        server.closeWithTimeout('shutdown', 5000).then(complete.resolve);
      })
      .expectText('X')
      .wait(50)
      .exec(() => expect(complete.isResolved).isFalse())
      .sendText('x')
      .exec(() => expect(complete.await()).resolves());
  });

  it('times out if client takes too long to respond to a close signal', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));
    const complete = new Sentinel();

    await request(server)
      .ws('/a')
      .expectJson()
      .exec(() => {
        server.closeWithTimeout('shutdown', 50).then(complete.resolve);
      })
      .expectText('X');

    const tm0 = Date.now();
    await expect(complete.await()).resolves();
    expect(Date.now() - tm0).isLessThan(200);
  });

  it('times out if client takes too long to respond to a ping', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY), {
      handlerOptions: { pingInterval: 100, pongTimeout: 100 },
    });
    const countConnections = () =>
      new Promise((resolve, reject) =>
        server.getConnections((error, n) => (error ? reject(error) : resolve(n))),
      );
    const proxy = new BreakableTcpProxy(server.address());
    await proxy.listen(0, 'localhost');
    try {
      await request(proxy.server).ws('/a').expectJson();

      expect(await countConnections()).toEqual(1);
      proxy.pullWire();
      await sleep(80);
      expect(await countConnections()).toEqual(1);
      await sleep(150);
      expect(await countConnections()).toEqual(0);
    } finally {
      proxy.close();
    }
  });

  it('waits for authentication if configured', async ({ getTyped }) => {
    const auth = mockAuth();
    const { server } = setupServer(getTyped(SERVER_FACTORY), { middleware: [auth.middleware] });

    await request(server)
      .ws('/a')
      .send('my-token')
      .expectJson({ init: { foo: 'v1' } })
      .exec(() => expect(auth.capturedToken).toEqual('my-token'));
  });

  it('survives if the connection is immediately closed', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    await request(server).ws('/a').close().expectClosed();
  });

  it('survives if the connection is closed while authenticating', async ({ getTyped }) => {
    const auth = mockAuth();
    const { server } = setupServer(getTyped(SERVER_FACTORY), { middleware: [auth.middleware] });

    await request(server).ws('/a').close().expectClosed();
  });

  it('invokes connection and disconnection callbacks', async ({ getTyped }) => {
    const onConnect = mock();
    const onDisconnect = mock();
    const { server } = setupServer(getTyped(SERVER_FACTORY), {
      handlerOptions: { onConnect, onDisconnect },
    });

    await request(server)
      .ws('/a')
      .expectJson()
      .exec(() => expect(onConnect).toHaveBeenCalledWith(any(), equals('a'), any()))
      .exec(() => expect(onDisconnect).not(toHaveBeenCalled()))
      .close()
      .expectClosed();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onDisconnect).toHaveBeenCalledWith(any(), 'client disconnect', isLessThan(1000));
  });
});

interface TestSetup {
  router: Router;
  server: AugmentedServer;
}

interface TestT {
  foo: string;
}

function setupServer(
  setup: TestSetup,
  {
    middleware = [],
    handlerOptions,
    permission = ReadWrite,
  }: {
    middleware?: UpgradeHandler[];
    handlerOptions?: Partial<
      WebsocketHandlerOptions<IncomingMessage & WithPathParameters<{ id: string }>>
    >;
    permission?: Permission<TestT, Spec<TestT>>;
  } = {},
) {
  const model = new InMemoryModel(validateTestT);
  model.set('a', { foo: 'v1' });

  const broadcaster = new Broadcaster<TestT, Spec<TestT>>(model, context);
  const handlerFactory = new WebsocketHandlerFactory(broadcaster);
  setup.router.ws(
    '/:id',
    ...middleware,
    handlerFactory.handler({
      accessGetter: (req) => {
        const id = getPathParameter(req, 'id');
        if (id === 'error') {
          throw new Error('oops');
        }
        return { id, permission };
      },
      acceptWebSocket,
      setSoftCloseHandler,
      ...handlerOptions,
    }),
  );

  return { server: setup.server };
}

function mockAuth() {
  const r = {
    capturedToken: '',
    middleware: requireBearerAuth({
      realm: () => '',
      extractAndValidateToken: (token) => {
        r.capturedToken = token;
        return {};
      },
      fallbackTokenFetcher: makeWebSocketFallbackTokenFetcher(acceptWebSocket),
    }),
  };
  return r;
}

function validateTestT(x: unknown): TestT {
  const test = x as TestT;
  if (test.foo === 'denied') {
    throw new Error('Test rejection');
  }
  return test;
}
