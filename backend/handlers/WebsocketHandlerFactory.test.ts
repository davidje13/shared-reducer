import type { Server } from 'node:http';
import context, { type Spec } from 'json-immutability-helper';
import type { Request } from 'express';
import { WebSocketExpress, type Router, type WSRequestHandler } from 'websocket-express';
import request from 'superwstest';
import { Sentinel } from '../../test-helpers/Sentinel';
import { runLocalServer, closeServer } from '../../test-helpers/serverRunner';
import { BreakableTcpProxy } from '../../test-helpers/BreakableTcpProxy';
import { sleep } from '../../test-helpers/sleep';
import { InMemoryModel } from '../model/InMemoryModel';
import { Broadcaster } from '../Broadcaster';
import { ReadWrite } from '../permission/ReadWrite';
import { ReadOnly } from '../permission/ReadOnly';
import { ReadWriteStruct } from '../permission/ReadWriteStruct';
import type { Permission } from '../permission/Permission';
import { WebsocketHandlerFactory, type WebsocketHandlerOptions } from './WebsocketHandlerFactory';

describe('WebsocketHandlerFactory', () => {
  const SERVER_FACTORY = beforeEach<TestSetup>(async ({ setParameter }) => {
    const app = new WebSocketExpress();
    const server = await runLocalServer(app);

    setParameter({ app, server });

    return () => closeServer(server);
  });

  it('creates a websocket-express compatible handler', async ({ getTyped }) => {
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

  it('rejects invalid messages', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    await request(server)
      .ws('/a')
      .expectJson()
      .sendText('{invalid}')
      .expectJson({ error: "Expected property name or '}' in JSON at position 1" });
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

  it('sends close message when softClose is called', async ({ getTyped }) => {
    const { server, handlerFactory } = setupServer(getTyped(SERVER_FACTORY));
    const complete = new Sentinel();

    await request(server)
      .ws('/a')
      .expectJson()
      .exec(() => {
        handlerFactory.softClose(5000).then(complete.resolve);
      })
      .expectText('X')
      .wait(50)
      .exec(() => expect(complete.isResolved).isFalse())
      .sendText('x')
      .exec(() => expect(complete.await()).resolves());
  });

  it('times out if client takes too long to respond to a close signal', async ({ getTyped }) => {
    const { server, handlerFactory } = setupServer(getTyped(SERVER_FACTORY));
    const complete = new Sentinel();

    await request(server)
      .ws('/a')
      .expectJson()
      .exec(() => {
        handlerFactory.softClose(50).then(complete.resolve);
      })
      .expectText('X');

    const tm0 = Date.now();
    await expect(complete.await()).resolves();
    expect(Date.now() - tm0).isLessThan(200);
  });

  it('does not accept new connections after softClose is called', async ({ getTyped }) => {
    const { server, handlerFactory } = setupServer(getTyped(SERVER_FACTORY));

    handlerFactory.softClose(5000);

    await request(server).ws('/a').expectConnectionError(503);
  });

  it('times out if client takes too long to respond to a ping', async ({ getTyped }) => {
    const { server, handlerFactory } = setupServer(getTyped(SERVER_FACTORY), {
      handlerOptions: { pingInterval: 100, pongTimeout: 100 },
    });
    const proxy = new BreakableTcpProxy(server.address());
    await proxy.listen(0, 'localhost');
    try {
      await request(proxy.server).ws('/a').expectJson();

      expect(handlerFactory.activeConnections()).toEqual(1);
      proxy.pullWire();
      await sleep(80);
      expect(handlerFactory.activeConnections()).toEqual(1);
      await sleep(150);
      expect(handlerFactory.activeConnections()).toEqual(0);
    } finally {
      proxy.close();
    }
  });

  it.ignore('waits for authentication if configured', async ({ getTyped }) => {
    let capturedToken = '';
    const { server } = setupServer(getTyped(SERVER_FACTORY), {
      middleware: [
        WebSocketExpress.requireBearerAuth(
          () => '',
          (token) => {
            capturedToken = token;
            return {};
          },
        ),
      ],
    });

    await request(server)
      .ws('/a')
      .send('my-token')
      .exec(() => expect(capturedToken).toEqual('my-token'))
      .expectJson({ init: { foo: 'v1' } });
  });

  it('survives if the connection is immediately closed', async ({ getTyped }) => {
    const { server } = setupServer(getTyped(SERVER_FACTORY));

    await request(server).ws('/a').close().expectClosed();
  });
});

interface TestSetup {
  app: Router;
  server: Server;
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
    middleware?: WSRequestHandler[];
    handlerOptions?: WebsocketHandlerOptions;
    permission?: Permission<TestT, Spec<TestT>>;
  } = {},
) {
  const model = new InMemoryModel(validateTestT);
  model.set('a', { foo: 'v1' });

  const broadcaster = new Broadcaster<TestT, Spec<TestT>>(model, context);
  const handlerFactory = new WebsocketHandlerFactory(broadcaster, handlerOptions);
  setup.app.ws(
    '/:id',
    ...middleware,
    handlerFactory.handler(
      (req: Request) => {
        const id = req.params['id'];
        if (id === 'error') {
          throw new Error('oops');
        }
        return id ?? '';
      },
      () => permission,
    ),
  );

  return { server: setup.server, handlerFactory };
}

function validateTestT(x: unknown): TestT {
  const test = x as TestT;
  if (test.foo === 'denied') {
    throw new Error('Test rejection');
  }
  return test;
}
