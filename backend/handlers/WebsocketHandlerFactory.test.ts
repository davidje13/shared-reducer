import type { Server } from 'node:http';
import context, { type Spec } from 'json-immutability-helper';
import type { Request } from 'express';
import { WebSocketExpress } from 'websocket-express';
import request from 'superwstest';
import { InMemoryModel } from '../model/InMemoryModel';
import { Broadcaster } from '../Broadcaster';
import { ReadWrite } from '../permission/ReadWrite';
import { ReadOnly } from '../permission/ReadOnly';
import { ReadWriteStruct } from '../permission/ReadWriteStruct';
import { Sentinel } from '../../test-helpers/Sentinel';
import { WebsocketHandlerFactory } from './WebsocketHandlerFactory';
import { runLocalServer, closeServer } from '../../test-helpers/serverRunner';
import type { Permission } from '../permission/Permission';

describe('WebsocketHandlerFactory', () => {
  const SERVER_FACTORY = beforeEach<TestServerFactory>(async ({ setParameter }) => {
    const app = new WebSocketExpress();
    const server = await runLocalServer(app);

    setParameter((handlerFactory, permission) => {
      app.ws(
        '/:id',
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

      return server;
    });

    return () => closeServer(server);
  });

  it('creates a websocket-express compatible handler', async ({ getTyped }) => {
    const server = getTyped(SERVER_FACTORY)(makeTestHandlerFactory(), ReadWrite);

    await request(server).ws('/a');
  });

  it('returns the initial state', async ({ getTyped }) => {
    const server = getTyped(SERVER_FACTORY)(makeTestHandlerFactory(), ReadWrite);

    await request(server)
      .ws('/a')
      .expectJson({ init: { foo: 'v1' } });
  });

  it('reflects changes', async ({ getTyped }) => {
    const server = getTyped(SERVER_FACTORY)(makeTestHandlerFactory(), ReadWrite);

    await request(server)
      .ws('/a')
      .expectJson()
      .sendJson({ change: { foo: ['=', 'v2'] } })
      .expectJson({ change: { foo: ['=', 'v2'] } });
  });

  it('rejects invalid messages', async ({ getTyped }) => {
    const server = getTyped(SERVER_FACTORY)(makeTestHandlerFactory(), ReadWrite);

    await request(server)
      .ws('/a')
      .expectJson()
      .sendText('{invalid}')
      .expectJson({ error: "Expected property name or '}' in JSON at position 1" });
  });

  it('handles errors from the idGetter', async ({ getTyped }) => {
    const server = getTyped(SERVER_FACTORY)(makeTestHandlerFactory(), ReadWrite);

    await request(server).ws('/error').expectConnectionError(500);
  });

  it('rejects changes in read-only mode', async ({ getTyped }) => {
    const server = getTyped(SERVER_FACTORY)(makeTestHandlerFactory(), ReadOnly);

    await request(server)
      .ws('/a')
      .expectJson()
      .sendJson({ change: { foo: ['=', 'v2'] } })
      .expectJson({ error: 'Cannot modify data' });
  });

  it('rejects changes forbidden by permissions', async ({ getTyped }) => {
    const server = getTyped(SERVER_FACTORY)(makeTestHandlerFactory(), new ReadWriteStruct(['foo']));

    await request(server)
      .ws('/a')
      .expectJson()
      .sendJson({ change: { foo: ['=', 'v2'] } })
      .expectJson({ error: 'Cannot edit field foo' });
  });

  it('rejects changes forbidden by model', async ({ getTyped }) => {
    const server = getTyped(SERVER_FACTORY)(makeTestHandlerFactory(), ReadWrite);

    await request(server)
      .ws('/a')
      .expectJson()
      .sendJson({ change: { foo: ['=', 'denied'] } })
      .expectJson({ error: 'Test rejection' });
  });

  it('reflects id field if provided', async ({ getTyped }) => {
    const server = getTyped(SERVER_FACTORY)(makeTestHandlerFactory(), ReadWrite);

    await request(server)
      .ws('/a')
      .expectJson()
      .sendJson({ change: { foo: ['=', 'v2'] }, id: 20 })
      .expectJson({ change: { foo: ['=', 'v2'] }, id: 20 });
  });

  it('sends updates to other subscribers without id field', async ({ getTyped }) => {
    const server = getTyped(SERVER_FACTORY)(makeTestHandlerFactory(), ReadWrite);

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
    const handlerFactory = makeTestHandlerFactory();
    const server = getTyped(SERVER_FACTORY)(handlerFactory, ReadWrite);
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
    const handlerFactory = makeTestHandlerFactory();
    const server = getTyped(SERVER_FACTORY)(handlerFactory, ReadWrite);
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
});

type TestServerFactory = (
  handlerFactory: WebsocketHandlerFactory<TestT, Spec<TestT>>,
  permission: Permission<TestT, Spec<TestT>>,
) => Server;

interface TestT {
  foo: string;
}

function makeTestHandlerFactory() {
  const model = new InMemoryModel(validateTestT);
  model.set('a', { foo: 'v1' });

  const broadcaster = new Broadcaster<TestT, Spec<TestT>>(model, context);
  return new WebsocketHandlerFactory(broadcaster);
}

function validateTestT(x: unknown): TestT {
  const test = x as TestT;
  if (test.foo === 'denied') {
    throw new Error('Test rejection');
  }
  return test;
}
