import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpServer } from '../src/http.js';
import { LibreChatClient } from '../src/client.js';
import { createMcpServer } from '../src/server.js';
import { MESSAGE_HTTP_BYTES, MESSAGE_MCP_BYTES } from '../src/tools/message-reads.js';
import { mockApi, listen, config, output } from './helpers.js';

test('exactly three concise reader tools, strict starts/cursor-only calls and compact single payload', async (t) => {
  const upstream = await mockApi(t, (_r, res) => {
    res.setHeader('x-librechat-message-reads', '2');
    return { schemaVersion: 2, conversationId: 'c', observability: { llmRequests: 'not_recorded', ptcInnerCalls: 'not_recorded' }, items: [{ messageId: 'm', metadata: { usage: { input: '12', futureCount: 3 } } }], nextCursor: null };
  });
  const origin = await listen(t, createHttpServer(config(upstream.origin)));
  const client = new Client({ name: 'bounded-test', version: '2' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name: `librechat_${name}`, arguments: args });
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 56);
  const readers = tools.filter((tool) => /messages_/.test(tool.name) && tool.name !== 'librechat_messages_search');
  assert.deepEqual(readers.map((tool) => tool.name).sort(), ['librechat_messages_content', 'librechat_messages_list', 'librechat_messages_read']);
  for (const tool of readers) { assert.equal(tool.annotations?.readOnlyHint, true); assert.ok(tool.description!.length < 160); assert.equal(tool.inputSchema.additionalProperties, false); }
  const result = await call('messages_list', { conversationId: 'c', messageId: 'm', includeContext: true });
  assert.deepEqual(output(result), { conversationId: 'c', observability: { llmRequests: 'not_recorded', ptcInnerCalls: 'not_recorded' }, items: [{ messageId: 'm', metadata: { usage: { input: '12', futureCount: 3 } } }], nextCursor: null });
  assert.equal(result.structuredContent, undefined);
  assert.equal((result.content as unknown[]).length, 1);
  await call('messages_content', { ref: 'opaque', ancestry: [3, 1], kind: 'tools', limit: 2 });
  let last = new URL(upstream.seen.at(-1)!.path, upstream.origin);
  assert.equal(last.pathname, '/api/message-reads/content');
  assert.equal(last.searchParams.get('ancestry'), '3,1');
  await call('messages_read', { ref: 'opaque', field: 'output', index: 0, maxBytes: 512 });
  for (const name of ['messages_list', 'messages_content', 'messages_read']) {
    await call(name, { cursor: 'opaque.cursor' });
    last = new URL(upstream.seen.at(-1)!.path, upstream.origin);
    assert.deepEqual([...last.searchParams], [['cursor', 'opaque.cursor']]);
  }
  const count = upstream.seen.length;
  for (const [name, args] of [
    ['messages_list', {}], ['messages_list', { conversationId: 'c', messageId: 'm', limit: 1 }],
    ['messages_content', { ref: 'r', conversationId: 'c' }], ['messages_content', { conversationId: 'c', messageId: 'm', ancestry: ['tool_call'] }],
    ['messages_read', { ref: 'r', field: 'output' }], ['messages_read', { ref: 'r', field: 'text', index: 0 }],
    ['messages_read', { cursor: 'r', maxBytes: 5 }], ['messages_list', { cursor: 'r', conversationId: 'c' }],
    ['messages_content', { conversationId: 'c', messageId: 'm', full: true }],
    ...[0, -1, 1.5, 101, '2'].map((limit) => ['messages_content', { conversationId: 'c', messageId: 'm', limit }]),
  ] as [string, Record<string, unknown>][]) assert.equal((await call(name, args)).isError, true);
  assert.equal(upstream.seen.length, count);
  for (const fraction of ['', '.1', '.12', '.123']) {
    const accepted = await call('messages_list', { conversationId: 'c', from: `2026-10-01T00:00:00${fraction}Z` });
    assert.equal(accepted.isError, false);
  }
  const afterValid = upstream.seen.length;
  for (const from of ['2026-10-01T00:00:00.1234Z', '2026-10-01T00:00Z', '2026-10-01T00:00:00+00:00', '2026-02-30T00:00:00Z']) {
    assert.equal((await call('messages_list', { conversationId: 'c', from })).isError, true);
  }
  assert.equal(upstream.seen.length, afterValid);
  assert.match(readers.find((tool) => tool.name.endsWith('messages_list'))!.description!, /Start with conversationId.*absent\/incomplete/);
  assert.match(readers.find((tool) => tool.name.endsWith('messages_content'))!.description!, /conversationId\+messageId or a ref/);
  const readTool = readers.find((tool) => tool.name.endsWith('messages_read'))!;
  assert.match(readTool.description!, /ref from messages_content.*entry is default/);
  assert.match((readTool.inputSchema.properties!.index as { description: string }).description, /required except/);
});

test('old upstream and incompatible success schema fail closed with no fallback or diagnostic echo', async (t) => {
  let mode = 0;
  const upstream = await mockApi(t, (_r, res) => {
    if (mode === 0) { res.statusCode = 404; return { diagnostic: 'synthetic-private-marker' }; }
    res.setHeader('x-librechat-message-reads', mode === 1 ? '1' : '2');
    return { schemaVersion: 1, diagnostic: 'synthetic-private-marker' };
  });
  const client = new Client({ name: 'old-upstream-test', version: '2' });
  const server = createMcpServer(config(upstream.origin));
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  for (mode = 0; mode < 3; mode++) {
    const result = await client.callTool({ name: 'librechat_messages_list', arguments: { conversationId: 'c' } });
    assert.equal(output(result).error.code, 'BOUNDED_READ_UNSUPPORTED');
    assert.equal(JSON.stringify(result).includes('synthetic-private-marker'), false);
  }
  assert.deepEqual(upstream.seen.map((r) => new URL(r.path, upstream.origin).pathname), Array(3).fill('/api/message-reads/list'));
});

test('bounded errors remain actionable without forwarding untrusted diagnostics', async (t) => {
  const upstream = await mockApi(t, (_r, res) => { res.statusCode = 409; res.setHeader('x-librechat-message-reads', '2'); return { schemaVersion: 2, error: { code: 'STALE_CURSOR', message: 'synthetic-private-marker' } }; });
  const api = new LibreChatClient(config(upstream.origin));
  await assert.rejects(api.request({ path: '/api/message-reads/read', maxResponseBytes: MESSAGE_HTTP_BYTES, messageReadsCapability: true }), (error: any) => {
    assert.equal(error.code, 'STALE_CURSOR'); assert.match(error.message, /Restart/); assert.equal(error.data, undefined); return true;
  });
});

test('advertised bounded response is stopped at the decoded HTTP backstop', async (t) => {
  const upstream = await mockApi(t, (_r, res) => { res.setHeader('x-librechat-message-reads', '2'); return { schemaVersion: 2, data: '中😀'.repeat(400_000) }; });
  const api = new LibreChatClient(config(upstream.origin));
  await assert.rejects(api.request({ path: '/api/message-reads/read', maxResponseBytes: MESSAGE_HTTP_BYTES, messageReadsCapability: true }), (error: any) => error.code === 'MESSAGE_READ_TOO_LARGE');
});

test('post-redaction MCP envelope backstop logs only final error metadata', async (t) => {
  const logs: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; });
  const api = new LibreChatClient(config('http://unused.invalid'));
  t.mock.method(api, 'request', async () => ({ status: 200, data: { schemaVersion: 2, data: '\u0000'.repeat(100_000) } }));
  const server = createMcpServer(config('http://unused.invalid'), api);
  const client = new Client({ name: 'envelope-test', version: '2' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const result = await client.callTool({ name: 'librechat_messages_read', arguments: { ref: 'r', field: 'text' } });
  assert.equal(output(result).error.code, 'MESSAGE_READ_TOO_LARGE');
  assert.ok(Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: 2, result })) < MESSAGE_MCP_BYTES);
  const log = logs.map((line) => JSON.parse(line)).find((entry) => entry.tool === 'librechat_messages_read');
  assert.deepEqual(Object.keys(log).sort(), ['durationMs', 'outcome', 'tool']); assert.equal(log.outcome, 'error');
});

test('generic API still recognizes an HTTP 200 SSE application failure', async (t) => {
  const upstream = await mockApi(t, (_r, res) => { res.setHeader('content-type', 'text/event-stream'); res.end('event: error\ndata: {"diagnostic":"synthetic-private-marker"}\n\n'); return undefined; });
  const api = new LibreChatClient(config(upstream.origin));
  await assert.rejects(api.request({ path: '/api/messages/c/m', maxResponseBytes: MESSAGE_HTTP_BYTES }), (error: any) => { assert.equal(error.code, 'UPSTREAM_STREAM_ERROR'); assert.equal(error.data, undefined); return true; });
});
