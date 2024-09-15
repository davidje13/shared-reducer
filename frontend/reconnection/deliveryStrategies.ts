export type DeliveryStrategy<T, SpecT> = (serverState: T, spec: SpecT, hasSent: boolean) => boolean;

export const AT_LEAST_ONCE: DeliveryStrategy<unknown, unknown> = () => true;
export const AT_MOST_ONCE: DeliveryStrategy<unknown, unknown> = (_serverState, _spec, hasSent) =>
  !hasSent;
