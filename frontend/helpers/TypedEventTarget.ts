type EventHandler<E extends Event> = ((e: E) => void) | { handleEvent(e: E): void };

export class TypedEventTarget<Events extends Record<string, Event>> extends EventTarget {
  override addEventListener<K extends keyof Events & string>(
    type: K,
    callback: EventHandler<Events[K]> | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(type, callback as EventListenerOrEventListenerObject, options);
  }

  override removeEventListener<K extends keyof Events & string>(
    type: K,
    callback: EventHandler<Events[K]> | null,
    options?: EventListenerOptions | boolean,
  ): void {
    super.removeEventListener(type, callback as EventListenerOrEventListenerObject, options);
  }

  override dispatchEvent<K extends keyof Events & string>(
    event: TypedEvent<K, Events[K]>,
  ): boolean {
    return super.dispatchEvent(event);
  }
}

export const makeEvent: EventMaker = <K extends string, D>(type: K, detail?: D) =>
  new CustomEvent<D>(type, { detail: detail! }) as TypedEvent<K, CustomEvent<D>>;

type TypedEvent<Type extends string, T extends Event> = T & { readonly type: Type };

type EventMaker = (<K extends string, D>(type: K, detail: D) => TypedEvent<K, CustomEvent<D>>) &
  (<K extends string>(type: K) => TypedEvent<K, CustomEvent<void>>);
