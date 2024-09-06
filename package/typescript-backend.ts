import { Broadcaster, websocketHandler, ReadWrite, InMemoryModel } from 'shared-reducer/backend';
import context, { type Spec } from 'json-immutability-helper';
import { Request } from 'express';
import { WebSocketExpress } from 'websocket-express';

interface Type {
  foo: string;
}

(async () => {
  const model = new InMemoryModel<string, Type>();
  model.set('a', { foo: 'v1' });
  const broadcaster = Broadcaster.for(model).withReducer<Spec<Type>>(context).build();

  broadcaster.update('a', { foo: ['=', 'v2'] });

  //@ts-expect-error
  broadcaster.update('a', { foo: ['=', 0] });

  const app = new WebSocketExpress();

  const handler = websocketHandler(broadcaster);
  app.ws(
    '/:id',
    handler(
      (req: Request) => req.params.id,
      () => ReadWrite,
    ),
  );

  const server = app.listen(0, 'localhost');
  server.close();

  const subscription = await broadcaster.subscribe('a', (change, meta) => {
    /*...*/
  });

  if (subscription) {
    const begin = subscription.getInitialData();
    await subscription.send(['=', { foo: 'v3' }]);
    // callback provided earlier is invoked

    await subscription.close();
  }
})();
