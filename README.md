# Shared Reducer

Shared state management via websockets.

Designed to work with
[json-immutability-helper](https://github.com/davidje13/json-immutability-helper).

## Install dependency

```bash
npm install --save shared-reducer json-immutability-helper
```

(if you want to use an alternative reducer, see the instructions below).

## Usage (Backend)

This project is compatible with
[websocket-express](https://github.com/davidje13/websocket-express),
but can also be used in isolation.

### With websocket-express

```js
import {
  Broadcaster,
  websocketHandler,
  InMemoryModel,
  ReadWrite,
} from 'shared-reducer/backend';
import context from 'json-immutability-helper';
import { WebSocketExpress } from 'websocket-express';

const model = new InMemoryModel();
const broadcaster = Broadcaster.for(model)
  .withReducer(context)
  .build();
model.set('a', { foo: 'v1' });

const app = new WebSocketExpress();
const server = app.listen(0, 'localhost');

const handler = websocketHandler(broadcaster);
app.ws('/:id', handler((req) => req.params.id, () => ReadWrite));
```

For real use-cases, you will probably want to add authentication middleware
to the expressjs chain, and you may want to give some users read-only and
others read-write access, which can be achieved in the second lambda.

### Alone

```js
import { Broadcaster, InMemoryModel } from 'shared-reducer/backend';
import context from 'json-immutability-helper';

const model = new InMemoryModel();
const broadcaster = Broadcaster.for(model)
  .withReducer(context)
  .build();
model.set('a', { foo: 'v1' });

// ...

const subscription = await broadcaster.subscribe(
  'a',
  (change, meta) => { /*...*/ },
);

const begin = subscription.getInitialData();
await subscription.send(['=', { foo: 'v2' }]);
// callback provided earlier is invoked

await subscription.close();
```

## Persisting data

A convenience wrapper is provided for use with
[collection-storage](https://github.com/davidje13/collection-storage),
or you can write your own implementation of the `Model` interface to
link any backend.

```js
import {
  Broadcaster,
  CollectionStorageModel,
} from 'shared-reducer/backend';
import context from 'json-immutability-helper';
import CollectionStorage from 'collection-storage';

const db = await CollectionStorage.connect('memory://something');
const model = new CollectionStorageModel(
  db.getCollection('foo'),
  'id',
  // a function which takes in an object and returns it if valid,
  // or throws if invalid (protects stored data from malicious changes)
  MY_VALIDATOR,
);
const broadcaster = Broadcaster.for(model)
  .withReducer(context)
  .build();
```

Note that the provided validator MUST verify structural integrity (e.g.
ensuring no unexpected fields are added or types are changed).

## Usage (Frontend)

```javascript
import { SharedReducer, actionsHandledCallback, actionsSyncedCallback } from 'shared-reducer/frontend';
import context from 'json-immutability-helper';

const reducer = SharedReducer
  .for('ws://destination', (state) => {
    console.log('latest state is', state);
  })
  .withReducer(context)
  .withToken('my-token')
  .withErrorHandler((error) => { console.log('connection lost', error); })
  .withWarningHandler((warning) => { console.log('latest change failed', warning); })
  .build();

const dispatch = reducer.dispatch;

dispatch([
  { a: ['=', 8] },
]);

dispatch([
  (state) => {
    return {
      a: ['=', Math.pow(2, state.a)],
    };
  },
]);

dispatch([
  actionsHandledCallback((state) => {
    console.log('state after handling is', state);
  }),
]);

dispatch([
  actionsSyncedCallback((state) => {
    console.log('state after syncing is', state);
  }),
]);

dispatch([
  { a: ['add', 1] },
  { a: ['add', 1] },
]);
```

### Specs

The specs need to match whichever reducer you are using. In the examples
above, that is
[json-immutability-helper](https://github.com/davidje13/json-immutability-helper).

## WebSocket protocol

The websocket protocol is minimal:

### Client-to-server

`<token>`:
The authentication token is sent as the first message when the connection is
established. This is plaintext. The server should respond by either terminating
the connection (if the token is deemed invalid), or with an `init` event which
defines the latest state in its entirety. If no token is specified using
`withToken`, no message will be sent (when not using authentication, it is
assumed the server will send the `init` event unprompted).

`P` (ping):
Can be sent periodically to keep the connection alive. The server sends a
"Pong" message in response immediately.

`{"change": <spec>, "id": <id>}`:
Defines a delta. This may contain the aggregate result of many operations
performed on the client. The ID is an opaque identifier which is reflected
back to the same client in the confirmation message. Other clients will not
receive the ID.

### Server-to-client

`p` (pong):
Reponse to a ping. May also be sent unsolicited.

`{"init": <state>}`:
The first message sent by the server, in response to a successful
connection.

`{"change": <spec>}`:
Sent whenever another client has changed the server state.

`{"change": <spec>, "id": <id>}`:
Sent whenever the current client has changed the server state. Note that
the spec and ID will match the client-sent values.

The IDs sent by different clients can coincide, so the ID is only reflected
to the client which sent the spec.

`{"error": <message>, "id": <id>}`:
Sent if the server rejects a client-initiated change.

If this is returned, the server state will not have changed (i.e. the
entire spec failed).

### Specs

The specs need to match whichever reducer you are using. In the examples
above, that is
[json-immutability-helper](https://github.com/davidje13/json-immutability-helper).

## Alternative reducer

To enable different features of `json-immutability-helper`, you can
customise it before passing it to `withReducer`. For example, to
enable list commands such as `updateWhere` and mathematical commands
such as Reverse Polish Notation (`rpn`):

### Backend

```js
import { Broadcaster, InMemoryModel } from 'shared-reducer/backend';
import listCommands from 'json-immutability-helper/commands/list';
import mathCommands from 'json-immutability-helper/commands/math';
import context from 'json-immutability-helper';

const broadcaster = Broadcaster.for(new InMemoryModel())
  .withReducer(context.with(listCommands, mathCommands))
  .build();
```

If you want to use an entirely different reducer, create a wrapper
and pass it to `withReducer`:

```js
import { Broadcaster, InMemoryModel } from 'shared-reducer/backend';

```

### Frontend

```js
import { SharedReducer } from 'shared-reducer/frontend';
import listCommands from 'json-immutability-helper/commands/list';
import mathCommands from 'json-immutability-helper/commands/math';
import context from 'json-immutability-helper';

const reducer = SharedReducer
  .for('ws://destination', (state) => {})
  .withReducer(context.with(listCommands, mathCommands))
  .build();
```

If you want to use an entirely different reducer, create a wrapper
and pass it to `withReducer`:

```js
import context from 'json-immutability-helper';

const myReducer = {
  update: (value, spec) => {
    // return a new value which is the result of applying
    // the given spec to the given value (or throw an error)
  },
  combine: (specs) => {
    // return a new spec which is equivalent to applying
    // all the given specs in order
  },
};

// backend
const broadcaster = Broadcaster.for(new InMemoryModel())
  .withReducer(myReducer)
  .build();

// frontend
const reducer = SharedReducer
  .for('ws://destination', (state) => {})
  .withReducer(myReducer)
  .build();
```

Be careful when using your own reducer to avoid introducing
security vulnerabilities; the functions will be called with
untrusted input, so should be careful to avoid attacks such
as code injection or prototype pollution.

## Other customisations (Backend)

The `Broadcaster` builder has other settable properties:

- `withSubscribers`: specify a custom keyed broadcaster, used
  for communicating changes to all consumers. Required interface:

  ```js
  {
    add(key, listener) {
      // add the listener function to key
    },
    remove(key, listener) {
      // remove the listener function from key
    },
    broadcast(key, message) {
      // call all current listener functions for key with
      // the parameter message
    },
  }
  ```

  All functions can be asynchronous or synchronous.

  The main use-case for overriding this would be to share
  messages between multiple servers for load balancing, but
  note that in most cases you probably want to load balance
  _documents_ rather than _users_ for better scalability.

- `withTaskQueues`: specify a custom task queue, used to ensure
  operations happen in the correct order. Required interface:

  ```js
  {
    push(key, task) {
      // add the (possibly asynchronous) task to the queue
      // for the given key
    },
  }
  ```

  The default implementation will execute the task if it is
  the first task in a particular queue. If there is already
  a task in the queue, it will be stored and executed once
  the existing tasks have finished. Once all tasks for a
  particular key have finished, it will remove the queue.

  As with `withSubscribers`, the main reason to override
  this is to provide consistency if multiple servers are
  able to modify the same document simultaneously.

- `withIdProvider`: specify a custom unique ID provider.
  Required interface:

  ```js
  {
    get() {
      // return a unique string (must be synchronous)
    },
  }
  ```

  The returned ID is used internally and passed through
  the configured `taskQueues` to identify the source of
  a change. It is not revealed to users. The default
  implementation uses a fixed random prefix followed by
  an incrementing number, which should be sufficient for
  most use cases.

## Older versions

For older versions of this library, see the separate
[backend](https://github.com/davidje13/shared-reducer-backend) and
[frontend](https://github.com/davidje13/shared-reducer-frontend) repositories.
