import type { TopicListener } from './Topic';

export interface TopicMap<K, T> {
  add(key: K, fn: TopicListener<T>): Promise<void> | void;
  remove(key: K, fn: TopicListener<T>): Promise<void> | void;
  broadcast(key: K, message: T): Promise<void> | void;
}
