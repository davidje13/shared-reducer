import type { ChangeEvent } from '../model/ChangeEvent';

export interface Message {
  change: unknown;
  events?: ChangeEvent[];
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
  const result: Message = { change: rawData.change };
  if ('events' in rawData) {
    if (
      !Array.isArray(rawData.events) ||
      rawData.events.some((o) => !Array.isArray(o) || typeof o[0] !== 'string')
    ) {
      throw new MessageParseError('If specified, events must be an array of events');
    }
    result.events = rawData.events;
  }
  if ('id' in rawData) {
    if (typeof rawData.id !== 'number') {
      throw new MessageParseError('If specified, id must be a number');
    }
    result.id = rawData.id;
  }
  return result;
}
