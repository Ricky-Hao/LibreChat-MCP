import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../client.js';
import { objectId, requireResource, segment, type Tools } from './common.js';

const conversationId = z.string().trim().min(1).describe('Conversation ID returned by LibreChat');
const messageId = z.string().trim().min(1).describe('Stored message ID');
const title = z.string().trim().max(1024);
const sortDirection = z.enum(['asc', 'desc']);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const matches = (data: unknown, id: string) =>
  record(data) && data.conversationId === id && data.message !== 'Error saving conversation';
// Optional filters must be absent, not serialized as the string "undefined".
const query = (input: Record<string, Query[string] | undefined>): Query =>
  Object.fromEntries(Object.entries(input).filter((entry): entry is [string, Query[string]] => entry[1] !== undefined));
const deletionCount = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0;

export const conversationsTools: Tools = (tool, api) => {
  tool('conversations_list', 'List owned conversations with cursor pagination. isArchived=false (also the upstream default) selects active only; true selects archived. pinned=true selects pinned only; false adds no pin filter. Search matches titles/messages via Meili, bounded to 1000 hits per index and subject to index staleness.', {
    cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(25),
    isArchived: z.boolean().optional(), pinned: z.boolean().optional(), tags: z.array(z.string()).optional(),
    search: z.string().optional(), sortBy: z.enum(['title', 'createdAt', 'updatedAt', 'archivedAt']).optional(),
    sortDirection: sortDirection.optional(), projectId: z.union([objectId, z.literal('unassigned')]).optional(),
  }, (input) => api.request({ path: '/api/convos', query: query(input) }), true);

  tool('conversations_get', 'Read owned conversation metadata. The messages field contains references, not message contents.', {
    conversationId,
  }, async ({ conversationId }) => requireResource(
    await api.request({ path: `/api/convos/${segment(conversationId)}` }),
    (data) => matches(data, conversationId), false,
  ), true);

  tool('conversations_messages_list', 'Page stored messages using the root /api/messages query route; returns the upstream envelope unchanged. pageSize has a local safety cap of 1000. Upstream timestamp cursors may skip timestamp ties or lose milliseconds; use conversations_messages_read for a complete transcript.', {
    conversationId, cursor: z.string().optional(), pageSize: z.number().int().min(1).max(1000).default(25),
    sortBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'), sortDirection: sortDirection.default('asc'),
  }, (input) => api.request({ path: '/api/messages', query: query(input) }), true);

  tool('conversations_messages_read', 'Read the full, unbounded array of stored messages across ALL branches, not just the active branch. Preserves structured content and parent IDs. Optional messageId returns a zero-or-one array via the narrower path.', {
    conversationId, messageId: messageId.optional(),
  }, ({ conversationId, messageId }) => api.request({
    path: `/api/messages/${segment(conversationId)}${messageId === undefined ? '' : `/${segment(messageId)}`}`,
  }), true);

  tool('messages_search', 'Search owned messages, including archived conversations, via Meili. Requires the upstream search index and may reflect stale/incomplete indexing. Returns the upstream envelope; limit caps hits at 1000, with no cursor or further pagination.', {
    query: z.string().trim().min(1), limit: z.number().int().min(1).max(1000).default(25),
  }, ({ query, limit }) => api.request({ path: '/api/messages', query: { search: query, pageSize: limit } }), true);

  tool('conversations_create', 'Create metadata with a generated UUID and title only. Uses the upstream title-upsert, not a dedicated create-only API; does not generate messages or call a model. Inspect state before retrying an uncertain write.', {
    title,
  }, async ({ title }) => {
    const conversationId = randomUUID();
    return requireResource(await api.request({ method: 'POST', path: '/api/convos/update', body: { arg: { conversationId, title } } }),
      (data) => matches(data, conversationId) && record(data) && data.title === title);
  });

  tool('conversations_update', 'Update only the title. First reads matching owned metadata to reduce accidental creation from a mistyped ID, then uses title-upsert. There is no atomic update-only operation or CAS: deletion between read and write can recreate metadata.', {
    conversationId, title,
  }, async ({ conversationId, title }) => {
    requireResource(await api.request({ path: `/api/convos/${segment(conversationId)}` }),
      (data) => matches(data, conversationId), false);
    return requireResource(await api.request({ method: 'POST', path: '/api/convos/update', body: { arg: { conversationId, title } } }),
      (data) => matches(data, conversationId) && record(data) && data.title === title);
  });

  tool('conversations_set_archived', 'Set archive state without upsert, preserving updatedAt. Missing conversations return 404. No CAS: a raced response with the opposite state is reported as uncertain, not success.', {
    conversationId, isArchived: z.boolean(),
  }, async ({ conversationId, isArchived }) => requireResource(
    await api.request({ method: 'POST', path: '/api/convos/archive', body: { arg: { conversationId, isArchived } } }),
    (data) => matches(data, conversationId) && record(data) && data.isArchived === isArchived,
  ));

  tool('conversations_set_pinned', 'Set pin state without upsert, preserving updatedAt. Missing conversations return 404. No CAS; verifies the returned ID and desired state, reporting mismatches as uncertain.', {
    conversationId, pinned: z.boolean(),
  }, async ({ conversationId, pinned }) => requireResource(
    await api.request({ method: 'POST', path: '/api/convos/pin', body: { arg: { conversationId, pinned } } }),
    (data) => matches(data, conversationId) && record(data) && data.pinned === pinned,
  ));

  tool('conversations_delete', 'Delete exactly one owned conversation by ID, cascading to owned children, messages, shared links and checkpoints. No uploaded-file erasure guarantee. Live generation draining and partial failures are possible; inspect uncertain results. No pre-read: an acknowledged zero-count replay is success.', {
    conversationId,
  }, async ({ conversationId }) => requireResource(
    await api.request({ method: 'DELETE', path: '/api/convos', body: { arg: { conversationId } } }),
    (data) => record(data) && data.acknowledged === true && deletionCount(data.deletedCount)
      && record(data.messages) && data.messages.acknowledged === true && deletionCount(data.messages.deletedCount)
      && Array.isArray(data.conversationIds) && data.conversationIds.every((id) => typeof id === 'string'),
  ));
};
