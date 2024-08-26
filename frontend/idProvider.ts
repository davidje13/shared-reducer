export type Provider<T> = () => T;

export function idProvider(): Provider<number> {
  let id = 1;
  return () => id++;
}
