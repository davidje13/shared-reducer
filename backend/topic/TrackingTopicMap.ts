import type { TopicMap } from './TopicMap';
import type { Topic, TopicListener } from './Topic';

export class TrackingTopicMap<K, T> implements TopicMap<K, T> {
  private readonly _data = new Map<K, Topic<T>>();

  public constructor(private readonly _topicFactory: (key: K) => Topic<T>) {}

  public async add(key: K, fn: TopicListener<T>) {
    let d = this._data.get(key);
    if (!d) {
      d = this._topicFactory(key);
      this._data.set(key, d);
    }
    await d.add(fn);
  }

  public async remove(key: K, fn: TopicListener<T>) {
    const d = this._data.get(key);
    if (d) {
      const anyRemaining = await d.remove(fn);
      if (!anyRemaining) {
        this._data.delete(key);
      }
    }
  }

  public async broadcast(key: K, message: T) {
    const d = this._data.get(key);
    if (d) {
      await d.broadcast(message);
    }
  }
}
