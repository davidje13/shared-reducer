import { type Context, type SpecGenerator, type SpecSource } from './DispatchSpec';

interface StackFrame<T> {
  _values: T[];
  _index: number;
  _prev: StackFrame<T> | null;
}

function iterateStack<T>(initial: T[], fn: (v: T) => T[] | null | undefined) {
  let cur: StackFrame<T> | null = { _values: initial, _index: 0, _prev: null };
  while (cur) {
    if (cur._index >= cur._values.length) {
      cur = cur._prev;
    } else {
      const next = fn(cur._values[cur._index]!);
      ++cur._index;
      if (next && next.length) {
        cur = { _values: next, _index: 0, _prev: cur };
      }
    }
  }
}

interface ReductionResult<T, SpecT> {
  _state: T;
  _delta: SpecT;
}

export function reduce<T, SpecT>(
  context: Context<T, SpecT>,
  state: T,
  baseChanges: SpecSource<T, SpecT>[],
): ReductionResult<T, SpecT> {
  const allChanges: SpecT[] = [];
  const aggregate: SpecT[] = [];
  function applyAggregate() {
    if (aggregate.length > 0) {
      const combinedChange = context.combine(aggregate);
      allChanges.push(combinedChange);
      state = context.update(state, combinedChange);
      aggregate.length = 0;
    }
  }

  iterateStack(baseChanges, (change) => {
    if (typeof change === 'function') {
      applyAggregate();
      const generator = change as SpecGenerator<T, SpecT>;
      return generator(state);
    }
    if (change) {
      aggregate.push(change);
    }
    return null;
  });
  applyAggregate();
  return { _state: state, _delta: context.combine(allChanges) };
}
