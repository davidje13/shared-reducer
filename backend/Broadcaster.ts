import { UniqueIdProvider } from './helpers/UniqueIdProvider';
import { TaskQueueMap } from './task-queue/TaskQueueMap';
import type { TopicMap } from './topic/TopicMap';
import { TrackingTopicMap } from './topic/TrackingTopicMap';
import { InMemoryTopic } from './topic/InMemoryTopic';
import type { Permission } from './permission/Permission';
import { ReadWrite } from './permission/ReadWrite';
import type { Model } from './model/Model';
import type { ChangeEvent } from './model/ChangeEvent';
import type { MaybePromise } from './helpers/MaybePromise';

export interface Context<T, SpecT> {
  update: (input: T, spec: SpecT) => T;
  isNoOp?: (spec: SpecT) => boolean;
}

type Listener<SpecT, MetaT> = (message: ChangeInfo<SpecT>, meta: MetaT | undefined) => void;

export interface SendOptions<T, SpecT> {
  before?: ((state: Readonly<T>) => MaybePromise<unknown>) | undefined;
  events?: ChangeEvent[] | undefined;
  permission: Permission<T, SpecT>;
}

export interface Subscription<T, SpecT, MetaT> {
  getInitialData(): Readonly<T>;
  listen(onChange: Listener<SpecT, MetaT>): void;
  send(
    change: SpecT,
    options?: Omit<SendOptions<T, SpecT>, 'permission'> | undefined,
    meta?: MetaT,
  ): Promise<void>;
  close(): Promise<void>;
}

type Identifier = string | null;

export type ChangeInfo<SpecT> =
  | { change: SpecT; events: Readonly<Readonly<ChangeEvent>[]> | undefined; error?: never }
  | { change?: never; events?: never; error: string };

export interface TopicMessage<SpecT> {
  message: ChangeInfo<SpecT>;
  source: Identifier;
  meta?: unknown;
}

export type EventFilter = (evt: Readonly<ChangeEvent>) => boolean;

type ID = string;

export class Broadcaster<T, SpecT> {
  private readonly _subscribers: TopicMap<ID, TopicMessage<SpecT>>;
  private readonly _taskQueues: TaskQueueMap<ID>;
  private readonly _idProvider: () => MaybePromise<string>;
  private readonly _onError: (error: unknown) => void;

  public constructor(
    private readonly _model: Model<ID, T>,
    private readonly _context: Context<T, SpecT>,
    options: {
      subscribers?: TopicMap<ID, TopicMessage<SpecT>>;
      taskQueues?: TaskQueueMap<ID>;
      idProvider?: () => MaybePromise<string>;
      onError?: (error: unknown) => void;
    } = {},
  ) {
    this._subscribers = options.subscribers ?? new TrackingTopicMap(() => new InMemoryTopic());
    this._taskQueues = options.taskQueues ?? new TaskQueueMap<ID>();
    this._idProvider = options.idProvider ?? UniqueIdProvider();
    this._onError = options.onError ?? ((err: unknown) => console.error(err));
  }

  public async subscribe<MetaT = void>(
    id: ID,
    permission: Permission<T, SpecT> = ReadWrite,
    eventFilter?: EventFilter | undefined,
  ): Promise<Subscription<T, SpecT, MetaT> | null> {
    let state:
      | { _stage: 0 }
      | { _stage: 1; _initialData: Readonly<T>; _queue: TopicMessage<SpecT>[] }
      | { _stage: 2; _onChange: Listener<SpecT, MetaT> } = { _stage: 0 };
    let myId = '';
    const eventHandler = (m: TopicMessage<SpecT>) => {
      if (state._stage === 2) {
        // we're up and running
        let message = m.message;
        if (eventFilter && message.events?.length) {
          let filteredEvents: Readonly<ChangeEvent>[] | undefined;
          try {
            filteredEvents = message.events.filter(eventFilter);
          } catch (error) {
            this._onError(`eventFilter threw: ${error}`);
            filteredEvents = undefined; // hide all events
          }
          if (!filteredEvents || filteredEvents.length < message.events.length) {
            message = { ...message, events: filteredEvents?.length ? filteredEvents : undefined };
          }
        }
        try {
          if (m.source === myId) {
            state._onChange(message, m.meta as MetaT);
          } else if (message.change) {
            if (!message.events?.length && this._context.isNoOp?.(message.change)) {
              return; // nothing to send
            }
            state._onChange(message, undefined);
          }
        } catch (error) {
          this._onError(`subscription listener threw: ${error}`);
        }
      } else if (state._stage === 1) {
        // we've loaded the initial data, but haven't yet called listen;
        // queue the event and we'll re-send it when listen is called.
        state._queue.push(m);
      }
    };

    try {
      await this._taskQueues.push(id, async () => {
        const data = await this._model.read(id);
        if (data !== null && data !== undefined) {
          state = { _stage: 1, _initialData: data, _queue: [] };
          await this._subscribers.add(id, eventHandler);
        }
      });
      if (state._stage === 0) {
        return null;
      }
      myId = await this._idProvider();
    } catch (e) {
      await this._subscribers.remove(id, eventHandler);
      throw e;
    }

    return {
      getInitialData() {
        if (state._stage !== 1) {
          throw new Error('Already started');
        }
        return state._initialData;
      },
      listen(onChange) {
        if (state._stage !== 1) {
          throw new Error('Already started');
        }
        const queue = state._queue;
        state = { _stage: 2, _onChange: onChange };
        queue.forEach(eventHandler);
      },
      send: (change, options, meta) =>
        this._internalQueueChange(id, change, { ...options, permission }, myId, meta),
      close: async () => {
        await this._subscribers.remove(id, eventHandler);
      },
    };
  }

  public update(
    id: ID,
    change: SpecT | ((state: Readonly<T>) => SpecT),
    { permission = ReadWrite, ...options }: Partial<SendOptions<T, SpecT>> = {},
  ): Promise<void> {
    return this._internalQueueChange(id, change, { ...options, permission }, null, undefined);
  }

  private async _internalApplyChange(
    id: ID,
    change: SpecT | ((state: Readonly<T>) => SpecT),
    { before, events, permission }: SendOptions<T, SpecT>,
    source: Identifier,
    meta: unknown,
  ) {
    if (events?.length) {
      for (const evt of events) {
        permission.validateEvent(evt);
      }
    }
    try {
      if (typeof change !== 'function') {
        permission.validateWriteSpec?.(change);
      }
      if (typeof change === 'function' || before || !this._context.isNoOp?.(change)) {
        const original = await this._model.read(id);
        if (!original) {
          throw new Error('Deleted');
        }
        if (before) {
          await before(original);
        }
        if (typeof change === 'function') {
          change = (change as (state: Readonly<T>) => SpecT)(original);
          permission.validateWriteSpec?.(change);
        }
        if (!this._context.isNoOp?.(change)) {
          const updated = this._context.update(original, change);
          const validatedUpdate = this._model.validate(updated);
          permission.validateWrite(validatedUpdate, original);

          await this._model.write(id, validatedUpdate, original);
        }
      }

      if (events?.length === 0) {
        events = undefined;
      }

      this._subscribers.broadcast(id, {
        message: { change, events },
        source,
        meta,
      });
    } catch (e) {
      if (!source) {
        throw e;
      }
      this._subscribers.broadcast(id, {
        message: { error: e instanceof Error ? e.message : 'Internal error' },
        source,
        meta,
      });
    }
  }

  private async _internalQueueChange(
    id: ID,
    change: SpecT | ((state: Readonly<T>) => SpecT),
    options: SendOptions<T, SpecT>,
    source: Identifier,
    meta: unknown,
  ): Promise<void> {
    return this._taskQueues.push(id, () =>
      this._internalApplyChange(id, change, options, source, meta),
    );
  }
}
