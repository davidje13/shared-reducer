import context from 'json-immutability-helper';
import {
  Broadcaster,
  WebsocketHandlerFactory,
  ReadWrite,
  InMemoryModel,
} from 'shared-reducer/backend';
import { SharedReducer } from 'shared-reducer/frontend';

const model = new InMemoryModel();
model.set('a', { foo: 'v1' });
const broadcaster = new Broadcaster(model, context);

const handlerFactory = new WebsocketHandlerFactory(broadcaster);
if (
  typeof handlerFactory.handler(
    (req) => req.params.id,
    () => ReadWrite,
  ) !== 'function'
) {
  throw new Error('invalid handler type');
}

const reducer = new SharedReducer(context, () => ({
  url: 'ws://example.com',
  token: 'my-token',
}));
reducer.addStateListener(() => null);
reducer.dispatch(['=', 1]);
reducer.close();
