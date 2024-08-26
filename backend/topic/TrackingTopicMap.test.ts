import { TrackingTopicMap } from './TrackingTopicMap';
import { InMemoryTopic } from './InMemoryTopic';

describe('TrackingTopicMap', () => {
  describe('add', () => {
    it('uses the provided factory to create new topics as required', async () => {
      const factory = mock(() => new InMemoryTopic<number>());
      const provider = new TrackingTopicMap(factory);

      await provider.add('key-1', () => null);
      expect(factory).toHaveBeenCalledWith('key-1');
    });

    it('reuses existing topics where available', async () => {
      const factory = mock(() => new InMemoryTopic<number>());
      const provider = new TrackingTopicMap(factory);
      await provider.add('key-1', () => null);
      await provider.add('key-1', () => null);

      expect(factory).toHaveBeenCalled({ times: 1 });
    });

    it('registers listeners with the topic', async () => {
      const topic = new InMemoryTopic<number>();
      const provider = new TrackingTopicMap(() => topic);

      const listener1 = mock<(v: number) => void>();
      const listener2 = mock<(v: number) => void>();

      await provider.add('key-1', listener1);
      await provider.add('key-1', listener2);

      topic.broadcast(1);
      expect(listener1).toHaveBeenCalledWith(1);
      expect(listener2).toHaveBeenCalledWith(1);
    });

    it('creates one topic per key', async () => {
      const factory = mock(() => new InMemoryTopic<number>());
      const provider = new TrackingTopicMap(factory);

      await provider.add('key-1', () => null);
      await provider.add('key-2', () => null);

      expect(factory).toHaveBeenCalledWith('key-1');
      expect(factory).toHaveBeenCalledWith('key-2');
    });
  });

  describe('remove', () => {
    it('removes the given listener', async () => {
      const topic = new InMemoryTopic<number>();
      const provider = new TrackingTopicMap(() => topic);

      const listener1 = mock<(v: number) => void>();
      const listener2 = mock<(v: number) => void>();

      await provider.add('key-1', listener1);
      await provider.add('key-1', listener2);
      topic.broadcast(1);
      expect(listener1).toHaveBeenCalledWith(1);
      expect(listener2).toHaveBeenCalledWith(1);

      await provider.remove('key-1', listener1);
      topic.broadcast(2);
      expect(listener1).not(toHaveBeenCalledWith(2));
      expect(listener2).toHaveBeenCalledWith(2);
    });

    it('clears the topic once all listeners are removed', async () => {
      const factory = mock(() => new InMemoryTopic<number>());
      const provider = new TrackingTopicMap(factory);
      const listener = () => null;

      await provider.add('key-1', listener);
      await provider.remove('key-1', listener);

      await provider.add('key-1', listener);
      expect(factory).toHaveBeenCalled({ times: 2 });
    });

    it('ignores requests to remove from unknown topics', async () => {
      const factory = mock(() => new InMemoryTopic<number>());
      const provider = new TrackingTopicMap(factory);

      await provider.remove('key-1', () => null);
      expect(factory).not(toHaveBeenCalled());
    });
  });

  describe('broadcast', () => {
    it('delegates to the requested topic', async () => {
      const factory = mock(() => new InMemoryTopic<number>());
      const provider = new TrackingTopicMap(factory);
      const listener1 = mock<(v: number) => void>();
      const listener2 = mock<(v: number) => void>();
      await provider.add('key-1', listener1);
      await provider.add('key-2', listener2);

      await provider.broadcast('key-1', 1);

      expect(listener1).toHaveBeenCalledWith(1);
      expect(listener2).not(toHaveBeenCalled());
    });

    it('ignores requests to broadcast for unknown topics', async () => {
      const factory = mock(() => new InMemoryTopic<number>());
      const provider = new TrackingTopicMap(factory);
      await provider.broadcast('key-1', 1);
      expect(factory).not(toHaveBeenCalled());
    });
  });
});
