export function actionsHandledCallback<T>(
  callback?: (state: T) => void,
): ((state: T) => null) | null {
  if (!callback) {
    return null;
  }
  return (state: T) => {
    callback(state);
    return null;
  };
}
