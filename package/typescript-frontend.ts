import {
  SharedReducer,
  actionsHandledCallback,
  actionsSyncedCallback,
} from 'shared-reducer/frontend';
import context from 'json-immutability-helper';

interface Type {
  a: number;
}

const reducer = SharedReducer.for<Type>('ws://destination', (state) => {
  console.log('latest state is', state);
})
  .withReducer(context)
  .withToken('my-token')
  .withErrorHandler((error) => {
    console.log('connection lost', error);
  })
  .withWarningHandler((warning) => {
    console.log('latest change failed', warning);
  })
  .build();

const dispatch = reducer.dispatch;

dispatch([{ a: ['=', 8] }]);

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

dispatch([{ a: ['add', 1] }, { a: ['add', 1] }]);
