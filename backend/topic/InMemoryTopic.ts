import type { Topic, TopicListener } from './Topic';

export class InMemoryTopic<T> implements Topic<T> {
  private readonly _subscribers = new Set<TopicListener<T>>();

  public add(fn: TopicListener<T>) {
    this._subscribers.add(fn);
  }

  public remove(fn: TopicListener<T>) {
    this._subscribers.delete(fn);
    return this._subscribers.size > 0;
  }

  public broadcast(message: T) {
    this._subscribers.forEach((sub) => sub(message));
  }
}
