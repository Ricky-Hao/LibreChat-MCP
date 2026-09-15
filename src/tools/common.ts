import { z } from 'zod';
import type { ApiResponse, LibreChatClient } from '../client.js';
import { ApiError } from '../client.js';

export type Register = <S extends z.ZodRawShape>(
  name: string, description: string, shape: S,
  run: (input: z.output<z.ZodObject<S>>) => Promise<unknown>, readOnly?: boolean,
) => void;
export type Tools = (register: Register, client: LibreChatClient) => void;
export const id = z.string().min(1).describe('Resource ID returned by LibreChat');
export const objectId = z.string().regex(/^[a-f\d]{24}$/i).describe('Mongo document _id');
export const jsonObject = z.record(z.string(), z.unknown());
export const text = z.string();
export const page = { limit: z.number().int().min(1).max(100).optional(), cursor: text.optional() };
export const segment = (s: string) => encodeURIComponent(s);
export const nonempty = <S extends z.ZodRawShape>(shape: S) =>
  z.strictObject(shape).refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

/** Some Prompt endpoints return HTTP 200 with an error message instead of a resource. */
export async function readBack(response: ApiResponse, read: () => Promise<ApiResponse>) {
  try { return { ...response, current: (await read()).data }; }
  catch { throw new ApiError('VERIFY_FAILED', 'Write was accepted but read-back failed. Inspect the resource before retrying.', response.status, response.data, true); }
}

export function requireResource<T>(response: ApiResponse<T>, valid: (data: T) => boolean, write = true): ApiResponse<T> {
  if (!valid(response.data)) {
    throw new ApiError('UNEXPECTED_RESPONSE', 'Upstream did not return the expected resource. Read back before retrying a write.', response.status, response.data, write);
  }
  return response;
}
