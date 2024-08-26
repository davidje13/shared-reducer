export type Lock = <R>(action: () => R) => R;

export function lock(errorMessage: string): Lock {
  let locked = false;
  return <R>(action: () => R): R => {
    if (locked) {
      throw new Error(errorMessage);
    }
    try {
      locked = true;
      return action();
    } finally {
      locked = false;
    }
  };
}
