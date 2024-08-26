import { InMemoryTopic } from './InMemoryTopic';

describe('InMemoryTopic', () => {
  describe('broadcast', () => {
    it('broadcasts messages to current subscribers', () => {
      const topic = new InMemoryTopic<number>();
      const listener = mock<(v: number) => void>();
      topic.add(listener);
      topic.broadcast(1);

      expect(listener).toHaveBeenCalledWith(1);
      expect(listener).toHaveBeenCalled({ times: 1 });
    });
  });

  describe('remove', () => {
    it('stops the listener receiving future broadcasts', () => {
      const topic = new InMemoryTopic<number>();
      const listener = mock<(v: number) => void>();
      topic.add(listener);
      topic.remove(listener);
      topic.broadcast(1);

      expect(listener).not(toHaveBeenCalled());
    });

    it('returns true if any subscribers remain', () => {
      const topic = new InMemoryTopic<number>();
      const listener1 = () => null;
      const listener2 = () => null;
      topic.add(listener1);
      topic.add(listener2);

      expect(topic.remove(listener1)).toEqual(true);
    });

    it('returns false if no subscribers remain', () => {
      const topic = new InMemoryTopic<number>();
      const listener = () => null;
      topic.add(listener);

      expect(topic.remove(listener)).toEqual(false);
    });
  });
});
