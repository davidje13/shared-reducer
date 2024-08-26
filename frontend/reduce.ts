import { type Context, type SpecGenerator, type SpecSource, SyncCallback } from './DispatchSpec';

interface StackFrame<T> {
  vs: T[];
  i: number;
  prev: StackFrame<T> | null;
}

function iterateStack<T>(initial: T[], fn: (v: T) => T[] | null | undefined) {
  let cur: StackFrame<T> | null = { vs: initial, i: 0, prev: null };
  while (cur) {
    if (cur.i >= cur.vs.length) {
      cur = cur.prev;
    } else {
      const next = fn(cur.vs[cur.i]!);
      cur.i += 1;
      if (next && next.length) {
        cur = { vs: next, i: 0, prev: cur };
      }
    }
  }
}

interface ReductionResult<T, SpecT> {
  state: T;
  delta: SpecT;
}

export function reduce<T, SpecT>(
  context: Context<T, SpecT>,
  oldState: T,
  baseChanges: SpecSource<T, SpecT>[],
  registerSyncCallback: (fn: SyncCallback<T>, currentState: T) => void,
): ReductionResult<T, SpecT> {
  let state: T = oldState;

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
    if (change instanceof SyncCallback) {
      applyAggregate();
      registerSyncCallback(change, state);
      return null;
    }
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
  return { state, delta: context.combine(allChanges) };
}
