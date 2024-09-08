import type { MaybePromise } from '../helpers/MaybePromise';

export type TopicListener<T> = (message: T) => void;

export interface Topic<T> {
  add(fn: TopicListener<T>): MaybePromise<void>;
  remove(fn: TopicListener<T>): MaybePromise<boolean>;
  broadcast(message: T): MaybePromise<void>;
}
