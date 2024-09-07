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
  const broadcaster = new Broadcaster<Type, Spec<Type>>(model, context);

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
