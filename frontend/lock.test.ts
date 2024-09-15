import { lock } from './lock';

describe('lock', () => {
  it('invokes the given function and passes through the returned value', () => {
    const myLock = lock('message');
    const result = myLock(() => 7);
    expect(result).toEqual(7);
  });

  it('invokes the given function and passes through the thrown exception', () => {
    const myLock = lock('message');
    expect(() =>
      myLock(() => {
        throw new Error('nope');
      }),
    ).throws('nope');
  });

  it('allows calling multiple functions successively', () => {
    const myLock = lock('message');
    expect(myLock(() => 7)).toEqual(7);
    expect(myLock(() => 8)).toEqual(8);
    expect(() =>
      myLock(() => {
        throw new Error('nope');
      }),
    ).throws('nope');
    expect(myLock(() => 9)).toEqual(9);
  });

  it('does not allow calling functions recursively', () => {
    const myLock = lock('message');
    expect(() => myLock(() => myLock(() => 7))).throws('message');
  });
});
