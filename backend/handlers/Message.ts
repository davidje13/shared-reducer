export interface Message {
  change: unknown;
  id?: number;
}

function isObject(o: unknown): o is Record<string, unknown> {
  return typeof o === 'object' && o !== null && !Array.isArray(o);
}

function validateMessage(rawData: unknown): Message {
  if (!isObject(rawData)) {
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

export function unpackMessage(msg: string): Message {
  // return json.parse(msg, json.object({
  //   change: json.record,
  //   id: json.optional(json.number),
  // }));

  return validateMessage(JSON.parse(msg));
}
