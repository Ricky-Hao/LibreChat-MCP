import { z } from 'zod';
import { ApiError } from '../client.js';
import type { ApiRequest } from '../client.js';
import type { Tools } from './common.js';

export const MESSAGE_HTTP_BYTES = 65_536;
export const MESSAGE_MCP_BYTES = 262_144;
export const guardedMessageTools = new Set(['messages_list', 'messages_content', 'messages_read']);
const id = z.string().min(1).max(512).optional();
const token = z.string().min(1).max(8192).optional();
const limit = z.number().int().min(1).max(100).optional();
const timestamp = z.iso.datetime().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/);

export const messageReadTools: Tools = (tool, api) => {
  const request = async (operation: 'list' | 'content' | 'read', input: Record<string, unknown>) => {
    const values = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const invalid = () => { throw new ApiError('INVALID_INPUT', 'Use start parameters or only cursor; check the selected scope and fields.'); };
    if (values.cursor !== undefined) {
      if (Object.keys(values).length !== 1) invalid();
    } else if (operation === 'list') {
      if (!values.conversationId || (values.messageId && ['timeField', 'from', 'to', 'direction', 'limit'].some((key) => key in values))) invalid();
    } else if (operation === 'content') {
      if (values.ref ? values.conversationId !== undefined || values.messageId !== undefined : !values.conversationId || !values.messageId) invalid();
    } else {
      if (!values.ref || (values.field === 'text' ? values.index !== undefined : values.index === undefined)) invalid();
    }
    const query: NonNullable<ApiRequest['query']> = {};
    for (const [key, value] of Object.entries(values)) query[key] = Array.isArray(value) ? value.join(',') : value as string | number | boolean;
    const result = await api.request({ path: `/api/message-reads/${operation}`, query, maxResponseBytes: MESSAGE_HTTP_BYTES, messageReadsCapability: true });
    if (!result.data || typeof result.data !== 'object' || !('schemaVersion' in result.data) || result.data.schemaVersion !== 2) {
      throw new ApiError('BOUNDED_READ_UNSUPPORTED', 'The upstream does not support bounded message reads v2. No full-message fallback is available.');
    }
    const { schemaVersion: _version, ...data } = result.data;
    return data;
  };
  tool('messages_list', 'Start with conversationId; optional messageId selects one. Stored usage may be absent/incomplete; request counts are not recorded. Continue with only cursor.', {
    conversationId: id, messageId: id, timeField: z.enum(['createdAt', 'updatedAt']).optional().describe('createdAt (default) or updatedAt; live timestamp+ID order.'),
    from: timestamp.optional().describe('Inclusive UTC start; seconds, optionally 1–3 fractional digits.'), to: timestamp.optional().describe('Exclusive UTC end; seconds, optionally 1–3 fractional digits.'), direction: z.enum(['asc', 'desc']).optional(),
    includeContext: z.boolean().optional(), limit, cursor: token,
  }, (input) => request('list', input), true);
  tool('messages_content', 'Start with conversationId+messageId or a ref from messages_content. List descriptors or tool states; select children with ancestry. Continue with only cursor.', {
    conversationId: id, messageId: id, ref: token.describe('Page ref from messages_content.'),
    ancestry: z.array(z.number().int().min(0).max(2_147_483_647)).min(1).max(16).optional().describe('Explicit root-to-child indices returned by children.ancestry; omitted keeps current scope.'),
    kind: z.enum(['all', 'tools']).optional().describe('all (default) or tools; stored states, not event history.'), limit, cursor: token,
  }, (input) => request('content', input), true);
  tool('messages_read', 'Start with ref from messages_content. Read UTF-8 segments; entry is default. Concatenate data, parse JSON when complete. Continue with only cursor.', {
    ref: token.describe('Page ref from messages_content.'), field: z.enum(['text', 'entry', 'args', 'output']).optional(),
    index: z.number().int().min(0).max(2_147_483_647).optional().describe('Descriptor index; required except for root message text.'), maxBytes: z.number().int().min(1).max(32_768).optional(), cursor: token,
  }, (input) => request('read', input), true);
};
