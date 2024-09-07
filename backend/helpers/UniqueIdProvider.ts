import { randomUUID } from 'node:crypto';

export const UniqueIdProvider = () => {
  const shared = randomUUID().substring(0, 8);
  let unique = 0;

  return () => {
    const id = unique++;
    return `${shared}-${id}`;
  };
};
