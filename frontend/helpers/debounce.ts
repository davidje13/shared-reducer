export function debounce(fn: () => void) {
  let tm: NodeJS.Timeout | null = null;
  const stop = () => {
    if (tm !== null) {
      clearTimeout(tm);
      tm = null;
    }
  };
  const run = () => {
    stop();
    fn();
  };

  return {
    _run: run,
    _schedule: () => {
      if (tm === null) {
        tm = setTimeout(run, 0);
      }
    },
    _stop: stop,
  };
}
