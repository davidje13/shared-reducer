export interface Message {
  change: unknown;
  id?: number;
}

export function unpackMessage(msg: string): Message {
  const rawData = JSON.parse(msg);
  if (typeof rawData !== 'object' || !rawData || Array.isArray(rawData)) {
    throw new Error('Must specify change and optional id');
  }
  const { id, change } = rawData;
  if (id === undefined) {
    return { change };
  }
  if (typeof id !== 'number') {
    throw new Error('if specified, id must be a number');
  }
  return { change, id };
}
