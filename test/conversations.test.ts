import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.js';
import { mockApi, config, output, skillId, type Seen } from './helpers.js';

async function setup(t: TestContext, reply: (r: Seen, res: ServerResponse) => unknown) {
  const upstream = await mockApi(t, reply);
  const server = createMcpServer(config(upstream.origin));
  const client = new Client({ name: 'conversation-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name: `librechat_${name}`, arguments: args });
  return { call, client, seen: upstream.seen, last: () => upstream.seen.at(-1)! };
}

const conversationId = 'convo/with space';
const metadata = { conversationId, title: 'Original', messages: ['root', 'branch-a', 'branch-b'], customMetadata: { retained: true } };
const messages = [
  { messageId: 'root', parentMessageId: null, conversationId, content: [{ type: 'text', text: 'question' }] },
  { messageId: 'branch-a', parentMessageId: 'root', conversationId, content: [{ type: 'tool_call', tool_call: { name: 'lookup', args: { key: 'value' }, output: { nested: [1, 2] } } }] },
  { messageId: 'branch-b', parentMessageId: 'root', conversationId, content: [{ type: 'image_url', image_url: { url: '/files/example.png' } }], extraField: 'preserved' },
];
const unexpected = (result: unknown, uncertain = true) => {
  const error = output(result).error;
  assert.equal(error.code, 'UNEXPECTED_RESPONSE');
  assert.equal(error.uncertain, uncertain);
};

// These mocks verify the MCP/HTTP contract, not upstream database ownership or cascade behavior.
test('conversation listing forwards repeated filters/cursors; metadata and root-query pages preserve envelopes', async (t) => {
  let wrongMetadata = false;
  const page = { messages, nextCursor: '2030-01-01T00:00:00.123Z', extra: { retained: true } };
  const listing = { conversations: [metadata], nextCursor: 'opaque+/=' };
  const h = await setup(t, (r) => {
    if (r.path.startsWith('/api/convos?')) return listing;
    if (r.path.startsWith('/api/messages?')) return page;
    return wrongMetadata ? { conversationId: 'different' } : metadata;
  });
  assert.deepEqual(output(await h.call('conversations_list')).data, listing);
  assert.equal(h.last().path, '/api/convos?limit=25');
  const filters = { cursor: 'opaque+/=', limit: 100, isArchived: false, pinned: true, tags: ['one two', 'a&b'], search: 'needle', sortBy: 'archivedAt', sortDirection: 'asc', projectId: skillId };
  await h.call('conversations_list', filters);
  const url = new URL(h.last().path, 'http://mock');
  assert.equal(url.pathname, '/api/convos');
  assert.deepEqual([...url.searchParams], [
    ['cursor', filters.cursor], ['limit', '100'], ['isArchived', 'false'], ['pinned', 'true'],
    ['tags', 'one two'], ['tags', 'a&b'], ['search', 'needle'], ['sortBy', 'archivedAt'], ['sortDirection', 'asc'], ['projectId', skillId],
  ]);
  await h.call('conversations_list', { projectId: 'unassigned', isArchived: true, pinned: false });
  assert.equal(h.last().path, '/api/convos?limit=25&isArchived=true&pinned=false&projectId=unassigned');
  assert.deepEqual(output(await h.call('conversations_get', { conversationId: ` ${conversationId} ` })).data, metadata);
  assert.equal(h.last().path, '/api/convos/convo%2Fwith%20space');
  wrongMetadata = true;
  unexpected(await h.call('conversations_get', { conversationId }), false);
  assert.deepEqual(output(await h.call('conversations_messages_list', { conversationId })).data, page);
  assert.equal(h.last().path, '/api/messages?conversationId=convo%2Fwith+space&pageSize=25&sortBy=createdAt&sortDirection=asc');
  await h.call('conversations_messages_list', { conversationId, cursor: page.nextCursor, pageSize: 1000, sortBy: 'updatedAt', sortDirection: 'desc' });
  assert.equal(h.last().path, '/api/messages?conversationId=convo%2Fwith+space&cursor=2030-01-01T00%3A00%3A00.123Z&pageSize=1000&sortBy=updatedAt&sortDirection=desc');
  const count = h.seen.length;
  for (const [name, args] of [
    ['conversations_list', { projectId: 'invalid' }], ['conversations_list', { limit: 101 }],
    ['conversations_messages_list', { conversationId, pageSize: 1001 }],
    ['conversations_messages_list', { conversationId, sortBy: 'endpoint' }],
  ] as const) assert.equal((await h.call(name, args)).isError, true);
  assert.equal(h.seen.length, count);
});

test('full reads preserve all stored branches and zero-or-one arrays; bounded search uses only root messages query', async (t) => {
  const search = { messages: [{ ...messages[2], isArchived: true }], nextCursor: null, upstreamField: 'kept' };
  const h = await setup(t, (r) => {
    if (r.path.startsWith('/api/messages?')) return search;
    if (r.path.endsWith('/missing')) return [];
    if (r.path.endsWith('/branch%2Fa')) return [messages[1]];
    return messages;
  });
  assert.deepEqual(output(await h.call('conversations_messages_read', { conversationId })).data, messages);
  assert.equal(h.last().path, '/api/messages/convo%2Fwith%20space');
  assert.deepEqual(output(await h.call('conversations_messages_read', { conversationId, messageId: ' branch/a ' })).data, [messages[1]]);
  assert.equal(h.last().path, '/api/messages/convo%2Fwith%20space/branch%2Fa');
  assert.deepEqual(output(await h.call('conversations_messages_read', { conversationId, messageId: 'missing' })).data, []);
  assert.deepEqual(output(await h.call('messages_search', { query: '  archived needle  ' })).data, search);
  assert.equal(h.last().path, '/api/messages?search=archived+needle&pageSize=25');
  await h.call('messages_search', { query: 'x&y', limit: 1000 });
  assert.equal(h.last().path, '/api/messages?search=x%26y&pageSize=1000');
  const count = h.seen.length;
  for (const args of [{ query: ' ' }, { query: 'x', limit: 1001 }, { query: 'x', limit: 0 }, { query: 'x', cursor: 'fake' }, { query: 'x', conversationId }, { query: 'x', sortBy: 'createdAt' }]) {
    assert.equal((await h.call('messages_search', args)).isError, true);
  }
  assert.equal((await h.call('conversations_messages_read', { conversationId, messageId: ' ' })).isError, true);
  assert.equal(h.seen.length, count);
  assert.ok(h.seen.every((r) => r.method === 'GET' && r.path.startsWith('/api/messages')));
  const tools = (await h.client.listTools()).tools;
  assert.match(tools.find((tool) => tool.name === 'librechat_conversations_messages_list')!.description!, /timestamp ties.*milliseconds/);
  assert.match(tools.find((tool) => tool.name === 'librechat_messages_search')!.description!, /Meili.*stale/);
});

test('create uses one generated UUID through auth replay; title-only update pre-reads and verifies resources', async (t) => {
  let mode = 'auth-replay';
  const h = await setup(t, (r, res) => {
    if (r.method === 'GET') {
      if (mode === 'missing') { res.statusCode = 404; return { error: 'Conversation not found' }; }
      return mode === 'wrong-read' ? { conversationId: 'different' } : metadata;
    }
    if (mode === 'auth-replay') { mode = 'ok'; res.statusCode = 401; return {}; }
    res.statusCode = 201;
    if (mode === 'save-error') return { message: 'Error saving conversation' };
    if (mode === 'wrong-title') return { ...r.body.arg, title: 'not requested' };
    if (mode === 'wrong-id') return { ...r.body.arg, conversationId: 'different' };
    return { ...r.body.arg, messages: [], extraField: 'retained' };
  });
  const created = output(await h.call('conversations_create', { title: '  New chat  ' }));
  assert.equal(created.status, 201);
  assert.match(created.data.conversationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(h.seen.length, 2);
  assert.deepEqual(h.seen[0].body, h.seen[1].body);
  assert.deepEqual(h.last().body, { arg: { conversationId: created.data.conversationId, title: 'New chat' } });
  assert.ok(h.seen.every((r) => r.method === 'POST' && r.path === '/api/convos/update'));
  assert.equal(created.data.extraField, 'retained');
  assert.equal((await h.call('conversations_update', { conversationId, title: '  Renamed  ' })).isError, false);
  assert.equal(h.seen.at(-2)!.method, 'GET');
  assert.equal(h.seen.at(-2)!.path, '/api/convos/convo%2Fwith%20space');
  assert.equal(h.last().path, '/api/convos/update');
  assert.deepEqual(h.last().body, { arg: { conversationId, title: 'Renamed' } });
  for (const failure of ['missing', 'wrong-read']) {
    mode = failure;
    const before: number = h.seen.length;
    const result = await h.call('conversations_update', { conversationId, title: 'Never sent' });
    assert.equal(result.isError, true);
    if (mode === 'missing') assert.equal(output(result).error.status, 404);
    else unexpected(result, false);
    assert.equal(h.seen.length, before + 1);
    assert.equal(h.last().method, 'GET');
  }
  for (const failure of ['save-error', 'wrong-title', 'wrong-id']) {
    mode = failure;
    for (const name of ['conversations_create', 'conversations_update']) {
      unexpected(await h.call(name, { title: 'New', ...(name === 'conversations_update' && { conversationId }) }));
    }
  }
  const count = h.seen.length;
  for (const args of [{ title: 'x', conversationId: 'chosen' }, { title: 'x', model: 'not-allowed' }, { title: 'x'.repeat(1025) }, {}]) {
    assert.equal((await h.call('conversations_create', args)).isError, true);
  }
  assert.equal(h.seen.length, count);
});

test('archive and pin send explicit booleans without pre-reads, rejecting mismatched state and embedded save errors', async (t) => {
  let mode = 'ok';
  const h = await setup(t, (r, res) => {
    if (mode === 'missing') { res.statusCode = 404; return { error: 'Conversation not found' }; }
    if (mode === 'save-error') return { message: 'Error saving conversation' };
    const field = r.path.endsWith('/archive') ? 'isArchived' : 'pinned';
    return { ...r.body.arg, updatedAt: '2030-01-01T00:00:00.123Z',
      ...(mode === 'opposite' && { [field]: !r.body.arg[field] }),
      ...(mode === 'wrong-id' && { conversationId: 'different' }),
      ...(mode === 'wrong-type' && { [field]: String(r.body.arg[field]) }),
    };
  });
  for (const [name, field, path] of [
    ['conversations_set_archived', 'isArchived', '/api/convos/archive'],
    ['conversations_set_pinned', 'pinned', '/api/convos/pin'],
  ] as const) {
    mode = 'ok';
    for (const state of [true, false]) {
      const before = h.seen.length;
      const result = await h.call(name, { conversationId, [field]: state });
      assert.equal(result.isError, false);
      assert.equal(output(result).data.updatedAt, '2030-01-01T00:00:00.123Z');
      assert.equal(h.seen.length, before + 1);
      assert.equal(h.last().method, 'POST');
      assert.equal(h.last().path, path);
      assert.deepEqual(h.last().body, { arg: { conversationId, [field]: state } });
    }
    for (const failure of ['opposite', 'wrong-id', 'save-error', 'wrong-type']) {
      mode = failure;
      unexpected(await h.call(name, { conversationId, [field]: true }));
    }
    mode = 'missing';
    assert.equal(output(await h.call(name, { conversationId, [field]: true })).error.status, 404);
    const count = h.seen.length;
    for (const value of ['false', 0, null, undefined]) {
      assert.equal((await h.call(name, { conversationId, [field]: value })).isError, true);
    }
    assert.equal(h.seen.length, count);
  }
});

test('single deletion has an exact payload, rejects dangerous inputs before HTTP, and checks both acknowledgements including zero-count replay', async (t) => {
  const success = { acknowledged: true, deletedCount: 1, messages: { acknowledged: true, deletedCount: 3 }, conversationIds: [conversationId], extra: 'preserved' };
  let response: unknown = success;
  const h = await setup(t, (_r, res) => { res.statusCode = 201; return response; });
  const deleted = await h.call('conversations_delete', { conversationId: ` ${conversationId} ` });
  assert.equal(deleted.isError, false);
  assert.deepEqual(output(deleted), { status: 201, data: success });
  response = { ...success, deletedCount: 0, messages: { acknowledged: true, deletedCount: 0 }, conversationIds: [] };
  assert.equal((await h.call('conversations_delete', { conversationId })).isError, false);
  assert.equal(h.seen.length, 2);
  for (const request of h.seen) {
    assert.equal(request.method, 'DELETE');
    assert.equal(request.path, '/api/convos');
    assert.deepEqual(request.body, { arg: { conversationId } });
  }
  const count = h.seen.length;
  for (const args of [
    {}, { conversationId: '' }, { conversationId: ' \n\t' }, { conversationId: { $ne: null } }, { conversationId: ['one', 'two'] },
    { conversationId, source: 'button' }, { conversationId, endpoint: 'agents' }, { conversationId, thread_id: 'thread' },
    { conversationId, all: true }, { conversationId, arg: {} }, { arg: { conversationId } },
  ]) assert.equal((await h.call('conversations_delete', args)).isError, true);
  // The same trimmed, nonblank ID schema protects the other named tools too.
  for (const [name, args] of [
    ['conversations_get', {}], ['conversations_messages_list', {}], ['conversations_messages_read', {}],
    ['conversations_update', { title: 'x' }], ['conversations_set_archived', { isArchived: true }], ['conversations_set_pinned', { pinned: false }],
  ] as const) assert.equal((await h.call(name, { ...args, conversationId: ' ' })).isError, true);
  assert.equal(h.seen.length, count);
  for (const malformed of [
    null, {}, { message: 'Error clearing conversations' }, { ...success, acknowledged: false },
    { ...success, deletedCount: '1' }, { ...success, deletedCount: -1 },
    { ...success, messages: { acknowledged: false, deletedCount: 0 } },
    { ...success, messages: undefined }, { ...success, messages: { acknowledged: true } },
    { ...success, conversationIds: undefined }, { ...success, conversationIds: [123] },
  ]) {
    response = malformed;
    unexpected(await h.call('conversations_delete', { conversationId }));
  }
  assert.ok(h.seen.every((r) => r.path === '/api/convos' && r.method === 'DELETE'));
});
