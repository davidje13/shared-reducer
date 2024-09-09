import {
  SharedReducer,
  actionsHandledCallback,
  actionsSyncedCallback,
} from 'shared-reducer/frontend';
import context, { type Spec } from 'json-immutability-helper';

interface Type {
  a: number;
}

const reducer = new SharedReducer<Type, Spec<Type>>(context, () => ({
  url: 'ws://destination',
  token: 'my-token',
}));

reducer.addStateListener((state) => {
  console.log('latest state is', state);
});

reducer.addEventListener('warning', (e) => {
  console.log('latest change failed', e);
});

const dispatch = reducer.dispatch;

dispatch([{ a: ['=', 8] }]);

dispatch([(state) => [{ a: ['=', Math.pow(2, state.a)] }]]);

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

dispatch([{ a: ['+', 1] }, { a: ['+', 1] }]);
