export interface Message {
  change: unknown;
  id?: number;
}

export class MessageParseError extends Error {}

export function unpackMessage(msg: string): Message {
  let rawData: unknown;
  try {
    rawData = JSON.parse(msg);
  } catch {
    throw new MessageParseError('Invalid JSON');
  }
  if (typeof rawData !== 'object' || !rawData || Array.isArray(rawData) || !('change' in rawData)) {
    throw new MessageParseError('Must specify change and optional id');
  }
  if ('id' in rawData) {
    if (typeof rawData.id !== 'number') {
      throw new MessageParseError('If specified, id must be a number');
    }
    return { change: rawData.change, id: rawData.id };
  }
  return { change: rawData.change };
}
