import { UniqueIdProvider } from './UniqueIdProvider';

describe('UniqueIdProvider', () => {
  it('returns distinct IDs for each call', () => {
    const provider = UniqueIdProvider();

    const observed = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const id = provider();
      expect(observed.has(id)).toBe(false);
      observed.add(id);
    }
  });

  it('returns distinct IDs across classes', () => {
    const observed = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const id = UniqueIdProvider()();
      expect(observed.has(id)).toBe(false);
      observed.add(id);
    }
  });
});
