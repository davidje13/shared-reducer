import { default as cs, type Collection } from 'collection-storage';
import { CollectionStorageModel } from './CollectionStorageModel';

// exports from collection-storage are not properly compatible with ES6 imports,
// so for now we map the values to maintain type safety:
const connectDB: (typeof cs)['connect'] = (cs as any).default.connect;

describe('CollectionStorageModel', () => {
  const STORAGE = beforeEach<{
    collection: Collection<TestT>;
    model: CollectionStorageModel<TestT>;
  }>(async ({ setParameter }) => {
    const db = await connectDB('memory://');
    const collection = db.getCollection<TestT>('col');
    await collection.add({ id: 'abc', foo: 6 });
    const model = new CollectionStorageModel(collection, 'id', validator);

    setParameter({ collection, model });

    return () => db.close();
  });

  describe('read', () => {
    it('returns data for the given key', async ({ getTyped }) => {
      const { model } = getTyped(STORAGE);
      const value = await model.read('abc');
      expect(value).toEqual({ id: 'abc', foo: 6 });
    });

    it('returns null for unknown keys', async ({ getTyped }) => {
      const { model } = getTyped(STORAGE);
      expect(await model.read('nope')).toEqual(null);
    });
  });

  describe('write', () => {
    it('replaces data', async ({ getTyped }) => {
      const { collection, model } = getTyped(STORAGE);
      const old = await model.read('abc');
      await model.write('abc', { id: 'abc', foo: 2 }, old!);

      const value = await collection.get('id', 'abc');
      expect(value).toEqual({ id: 'abc', foo: 2 });
    });

    it('applies diff from old value', async ({ getTyped }) => {
      const { collection, model } = getTyped(STORAGE);
      await model.write('abc', { id: 'abc', foo: 2 }, { id: 'abc', foo: 2 });

      // foo should not change as no diff was found
      const value = await collection.get('id', 'abc');
      expect(value).toEqual({ id: 'abc', foo: 6 });
    });

    it('avoids prototype access', async ({ getTyped }) => {
      const { collection, model } = getTyped(STORAGE);
      const spy = mock(collection, 'update').whenCalled().thenResolve(null);

      await model.write(
        'abc',
        JSON.parse('{"id":"x","foo":3,"__proto__":{"injected":"gotchya"}}'),
        { id: 'abc', foo: 2 },
      );

      const diff = spy.getInvocation().arguments[2] as any;
      expect(diff.injected).toBeUndefined();
      expect(diff.__proto__.injected).toEqual('gotchya');
    });
  });
});

interface TestT {
  id: string;
  foo: number;
}

function validator(x: unknown): TestT {
  const v = x as TestT;
  if (v.foo === -1) {
    throw new Error('rejected');
  }
  return v;
}
