export type ReconnectionStrategy<T, SpecT> = (
  serverState: T,
  spec: SpecT,
  hasSent: boolean,
) => boolean;

export const AT_LEAST_ONCE: ReconnectionStrategy<unknown, unknown> = () => true;
export const AT_MOST_ONCE: ReconnectionStrategy<unknown, unknown> = (
  _serverState,
  _spec,
  hasSent,
) => !hasSent;
