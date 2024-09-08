import type { MaybePromise } from '../helpers/MaybePromise';
import type { TopicListener } from './Topic';

export interface TopicMap<K, T> {
  add(key: K, fn: TopicListener<T>): MaybePromise<void>;
  remove(key: K, fn: TopicListener<T>): MaybePromise<void>;
  broadcast(key: K, message: T): MaybePromise<void>;
}
