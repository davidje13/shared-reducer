import { idProvider } from './idProvider';

describe('idProvider', () => {
  it('returns distinct IDs for each call', () => {
    const provider = idProvider();

    const observed = new Set<number>();
    for (let i = 0; i < 100; i += 1) {
      const id = provider();
      expect(observed.has(id)).toBe(false);
      observed.add(id);
    }
  });
});
