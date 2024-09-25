export const makeTimeout = (limit: number) => {
  const o = { stop: () => {} } as { promise: Promise<void>; stop: () => void };
  o.promise = new Promise((_, reject) => {
    const tm = setTimeout(() => reject(new Error(`Timed out after ${limit}ms`)), limit);
    o.stop = () => clearTimeout(tm);
  });
  return o;
};
