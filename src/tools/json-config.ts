import { types } from 'node:util';
import { z } from 'zod';
import { ApiError } from '../client.js';

export const JSON_CONFIG_LIMITS = { depth: 32, nodes: 10_000, bytes: 1_048_576 } as const;
function invalid(): never { throw new ApiError('INVALID_INPUT', 'Use a plain JSON object within 32 levels, 10000 values and 1 MiB; changes must be nonempty. Accessors, non-JSON values and __proto__ keys are not allowed.'); }

/** Validate before Zod copies record keys (it would otherwise silently drop __proto__). */
export function validateJsonConfig(input: unknown, nonempty = false): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || types.isProxy(input) || Array.isArray(input)) invalid();
  let nodes = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const add = (size: number) => { bytes += size; if (bytes > JSON_CONFIG_LIMITS.bytes) invalid(); };
  // Count the JSON string representation without allocating a large escaped copy.
  const stringBytes = (value: string) => {
    add(2);
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c === 34 || c === 92 || c === 8 || c === 9 || c === 10 || c === 12 || c === 13) add(2);
      else if (c < 32) add(6);
      else if (c < 128) add(1);
      else if (c < 2048) add(2);
      else if (c >= 0xd800 && c <= 0xdbff && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { add(4); i++; }
      else if (c >= 0xd800 && c <= 0xdfff) add(6);
      else add(3);
    }
  };
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > JSON_CONFIG_LIMITS.nodes || depth > JSON_CONFIG_LIMITS.depth) invalid();
    if (value === null) { add(4); return; }
    if (typeof value === 'string') { stringBytes(value); return; }
    if (typeof value === 'boolean') { add(value ? 4 : 5); return; }
    if (typeof value === 'number' && Number.isFinite(value)) { add(JSON.stringify(value).length); return; }
    if (typeof value !== 'object' || types.isProxy(value)) invalid();
    const object = value as object;
    const array = Array.isArray(object);
    const prototype = Object.getPrototypeOf(object);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid();
    if (ancestors.has(object)) invalid();
    const keys = Reflect.ownKeys(object);
    const count = keys.length - (array ? 1 : 0);
    if (count > JSON_CONFIG_LIMITS.nodes - nodes || (depth === 0 && nonempty && count === 0)) invalid();
    const length = array ? Object.getOwnPropertyDescriptor(object, 'length')!.value as number : 0;
    if (array && count !== length) invalid(); // Holes and extra array properties are not JSON data.
    ancestors.add(object);
    add(2 + Math.max(0, count - 1));
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || key === '__proto__') invalid();
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) invalid();
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) invalid();
      if (!array) { stringBytes(key); add(1); }
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(object);
  };
  visit(input, 0);
  return input as Record<string, unknown>;
}

/** Open, nonrecursive discovery schema; all generic JSON limits run before record parsing. */
export const jsonConfigSchema = (nonempty = false, reserved: readonly string[] = []) => z.preprocess(
  (input) => {
    const config = validateJsonConfig(input, nonempty);
    if (reserved.some((key) => Object.hasOwn(config, key))) {
      throw new ApiError('INVALID_INPUT', 'Configuration contains a reserved top-level operation control. Use the tool’s outer arguments or dedicated action.');
    }
    return config;
  },
  z.record(z.string(), z.unknown()),
).meta({ type: 'object', additionalProperties: {}, ...(nonempty && { minProperties: 1 }) });
