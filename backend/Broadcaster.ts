import { UniqueIdProvider } from './helpers/UniqueIdProvider';
import { TaskQueueMap } from './task-queue/TaskQueueMap';
import type { TopicMap } from './topic/TopicMap';
import { TrackingTopicMap } from './topic/TrackingTopicMap';
import { InMemoryTopic } from './topic/InMemoryTopic';
import type { Permission } from './permission/Permission';
import { ReadWrite } from './permission/ReadWrite';
import type { Model } from './model/Model';

export interface Context<T, SpecT> {
  update: (input: T, spec: SpecT) => T;
}

export interface Subscription<T, SpecT, MetaT> {
  getInitialData: () => Readonly<T>;
  send: (change: SpecT, meta?: MetaT) => Promise<void>;
  close: () => Promise<void>;
}

type Identifier = string | null;

export type ChangeInfo<SpecT> =
  | { change: SpecT; error?: undefined }
  | { change?: undefined; error: string };

export interface TopicMessage<SpecT> {
  message: ChangeInfo<SpecT>;
  source: Identifier;
  meta?: unknown;
}

interface BroadcasterBuilder<T, SpecT> {
  withReducer<SpecT2 extends SpecT>(context: Context<T, SpecT2>): BroadcasterBuilder<T, SpecT2>;

  withSubscribers(subscribers: TopicMap<TopicMessage<SpecT>>): this;

  withTaskQueues(taskQueues: TaskQueueMap<void>): this;

  withIdProvider(idProvider: UniqueIdProvider): this;

  build(): Broadcaster<T, SpecT>;
}

export class Broadcaster<T, SpecT> {
  private constructor(
    private readonly _model: Model<T>,
    private readonly _context: Context<T, SpecT>,
    private readonly _subscribers: TopicMap<TopicMessage<SpecT>>,
    private readonly _taskQueues: TaskQueueMap<void>,
    private readonly _idProvider: UniqueIdProvider,
  ) {}

  public static for<T2>(model: Model<T2>): BroadcasterBuilder<T2, unknown> {
    let bContext: Context<T2, unknown> | undefined;
    let bSubscribers: TopicMap<TopicMessage<unknown>> | undefined;
    let bTaskQueues: TaskQueueMap<void> | undefined;
    let bIdProvider: UniqueIdProvider | undefined;

    return {
      withReducer<SpecT2>(context: Context<T2, SpecT2>) {
        bContext = context as Context<T2, unknown>;
        return this as BroadcasterBuilder<T2, SpecT2>;
      },

      withSubscribers(subscribers: TopicMap<TopicMessage<unknown>>) {
        bSubscribers = subscribers;
        return this;
      },

      withTaskQueues(taskQueues: TaskQueueMap<void>) {
        bTaskQueues = taskQueues;
        return this;
      },

      withIdProvider(idProvider: UniqueIdProvider) {
        bIdProvider = idProvider;
        return this;
      },

      build() {
        if (!bContext) {
          throw new Error('must set broadcaster context');
        }
        return new Broadcaster(
          model,
          bContext,
          bSubscribers || new TrackingTopicMap(() => new InMemoryTopic()),
          bTaskQueues || new TaskQueueMap<void>(),
          bIdProvider || new UniqueIdProvider(),
        );
      },
    };
  }

  public async subscribe<MetaT>(
    id: string,
    onChange: (message: ChangeInfo<SpecT>, meta: MetaT | undefined) => void,
    permission: Permission<T, SpecT> = ReadWrite,
  ): Promise<Subscription<T, SpecT, MetaT> | null> {
    let initialData = await this._model.read(id);
    if (initialData === null || initialData === undefined) {
      return null;
    }

    const myId = this._idProvider.get();
    const eventHandler = ({ message, source, meta }: TopicMessage<SpecT>) => {
      if (source === myId) {
        onChange(message, meta as MetaT);
      } else if (message.change) {
        onChange(message, undefined);
      }
    };

    this._subscribers.add(id, eventHandler);

    return {
      getInitialData: (): Readonly<T> => {
        if (initialData === null) {
          throw new Error('Already fetched initialData');
        }
        const data = initialData!;
        initialData = null; // GC
        return data;
      },
      send: (change: SpecT, meta?: MetaT): Promise<void> =>
        this._internalQueueChange(id, change, permission, myId, meta),
      close: async () => {
        await this._subscribers.remove(id, eventHandler);
      },
    };
  }

  public update(
    id: string,
    change: SpecT,
    permission: Permission<T, SpecT> = ReadWrite,
  ): Promise<void> {
    return this._internalQueueChange(id, change, permission, null, undefined);
  }

  private async _internalApplyChange(
    id: string,
    change: SpecT,
    permission: Permission<T, SpecT>,
    source: Identifier,
    meta: unknown,
  ) {
    try {
      const original = await this._model.read(id);
      if (!original) {
        throw new Error('Deleted');
      }
      permission.validateWriteSpec?.(change);
      const updated = this._context.update(original, change);
      const validatedUpdate = this._model.validate(updated);
      permission.validateWrite(validatedUpdate, original);

      await this._model.write(id, validatedUpdate, original);
    } catch (e) {
      this._subscribers.broadcast(id, {
        message: { error: e instanceof Error ? e.message : 'Internal error' },
        source,
        meta,
      });
      return;
    }

    this._subscribers.broadcast(id, {
      message: { change },
      source,
      meta,
    });
  }

  private async _internalQueueChange(
    id: string,
    change: SpecT,
    permission: Permission<T, SpecT>,
    source: Identifier,
    meta: unknown,
  ): Promise<void> {
    return this._taskQueues.push(id, () =>
      this._internalApplyChange(id, change, permission, source, meta),
    );
  }
}
