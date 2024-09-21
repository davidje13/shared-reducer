import context, { type Spec } from 'json-immutability-helper';
import { SharedReducer } from 'shared-reducer/frontend';

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
  (state) => {
    console.log('state after handling is', state);
    return [];
  },
]);

dispatch(
  [{ a: ['=', 8] }],
  (state) => console.log('a after syncing is', state.a),
  (message) => console.log('failed', message.substring(1)),
);

dispatch([{ a: ['+', 1] }, { a: ['+', 1] }]);
