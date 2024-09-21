import context, { type Spec } from 'json-immutability-helper';
import { reduce } from './reduce';

describe('reduce', () => {
  it('recursively applies changes to the state', () => {
    const result = reduce<TestT, Spec<TestT>>(context, { foo: 1, bar: 1 }, [
      { foo: ['+', 1] },
      { bar: ['=', 5] },
      () => [{ foo: ['+', 2] }, () => [{ bar: ['+', 2] }]],
      { bar: ['+', 1] },
    ]);

    expect(result._state).toEqual({ foo: 4, bar: 8 });
    expect(result._delta).toEqual({
      foo: ['seq', ['+', 1], ['+', 2]],
      bar: ['seq', ['=', 5], ['+', 2], ['+', 1]],
    });
  });

  it('invokes generators with the current state', () => {
    let capturedState = {} as TestT;
    reduce<TestT, Spec<TestT>>(context, { foo: 1, bar: 1 }, [
      { foo: ['+', 1] },
      (s) => {
        capturedState = s;
        return [];
      },
      { foo: ['+', 1] },
    ]);

    expect(capturedState).toEqual({ foo: 2, bar: 1 });
  });

  it('ignores nulls', () => {
    const result = reduce<TestT, Spec<TestT>>(context, { foo: 1, bar: 1 }, [
      { foo: ['+', 1] },
      null,
      { bar: ['+', 2] },
    ]);

    expect(result._state).toEqual({ foo: 2, bar: 3 });
    expect(result._delta).toEqual({
      foo: ['+', 1],
      bar: ['+', 2],
    });
  });
});

interface TestT {
  foo: number;
  bar: number;
}
