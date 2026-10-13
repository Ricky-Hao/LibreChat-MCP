// Explicit local cross-repository check: LIBRECHAT_SOURCE_ROOT=../LibreChat node --import tsx --test test/bounded-upstream.integration.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer } from '../dist/http.js';
import { MESSAGE_HTTP_BYTES, MESSAGE_MCP_BYTES } from '../src/tools/message-reads.js';
import { listen, config, output, jwt, refreshToken } from './helpers.js';

test('production LibreChat handler/database -> HTTP -> real MCP transport stays bounded for a giant stored message', { timeout: 120_000 }, async (t) => {
  assert.ok(process.env.LIBRECHAT_SOURCE_ROOT, 'Set LIBRECHAT_SOURCE_ROOT to the authorized local LibreChat checkout');
  const root = resolve(process.env.LIBRECHAT_SOURCE_ROOT!);
  // Upstream singleton loggers otherwise create api/logs in this checkout on import.
  process.env.LOG_TO_FILE = 'false';
  const require = createRequire(resolve(root, 'package.json'));
  const express = require('express');
  const mongoose = require('mongoose');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const { createModels, createMethods } = require('@librechat/data-schemas');
  const { createMessageReadHandler, createMessageRequestMiddleware } = require('@librechat/api');
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  t.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
  createModels(mongoose);
  await Promise.all(Object.values(mongoose.models).map((model: any) => model.init()));
  const methods = createMethods(mongoose);
  const conversationId = '00000000-0000-4000-8000-000000000021';
  await mongoose.models.Conversation.collection.insertOne({ user: 'fixture-owner', conversationId });
  const args = { program: '中😀\n"\\\u0000'.repeat(70_000) };
  const resultText = 'synthetic-result-中😀'.repeat(110_000);
  await mongoose.models.Message.collection.insertOne({
    conversationId, messageId: 'giant', parentMessageId: 'branch-root', user: 'fixture-owner',
    createdAt: new Date(), updatedAt: new Date(), isCreatedByUser: false,
    text: 'synthetic body', content: [{ type: 'tool_call', tool_call: { id: 'call', name: 'run_tools_with_bash', args, output: resultText, subagent_content: [{ type: 'text', text: 'explicit nested content' }] } }],
  });
  const validation = createMessageRequestMiddleware({ getConvo: methods.getConvoOwnership, getJob: async () => null, isPendingActionStale: () => true, logger: { warn() {} } });
  const app = express();
  const upstreamSizes: number[] = [];
  app.post('/api/auth/refresh', (_req: any, res: any) => res.set('set-cookie', `refreshToken=${refreshToken}; HttpOnly`).json({ token: jwt }));
  app.use((req: any, res: any, next: () => void) => {
    if (req.headers.authorization !== `Bearer ${jwt}`) return res.sendStatus(401);
    req.user = { id: 'fixture-owner' };
    const send = res.send.bind(res);
    res.send = (value: any) => { if (typeof value === 'string') upstreamSizes.push(Buffer.byteLength(value)); return send(value); };
    next();
  });
  const descriptorResultSizes: number[] = [];
  const stringResultSizes: number[] = [];
  const deps = { getMessageReadMetadata: methods.getMessageReadMetadata, getMessageReadContent: async (input: any) => {
    const row = await methods.getMessageReadContent(input);
    if (!input.field) descriptorResultSizes.push(Buffer.byteLength(JSON.stringify(row)));
    if (row?.stringWindow !== undefined) stringResultSizes.push(Buffer.byteLength(JSON.stringify(row)));
    return row;
  }, validate: (req: any) => validation.createMessageRequestValidation(req, { explicitTenantScope: true }), getLimits: async () => undefined, getCursorKey: () => 'synthetic-reader-signing-key' };
  for (const operation of ['list', 'content', 'read']) app.get(`/api/message-reads/${operation}`, createMessageReadHandler(deps, operation));
  app.get('/api/messages/:conversationId/:messageId', async (req: any, res: any) => res.json(await methods.getMessages({ user: req.user.id, ...req.params })));
  const upstream = await listen(t, createServer(app));
  const rawLegacy = await fetch(`${upstream}/api/messages/${conversationId}/giant`, { headers: { authorization: `Bearer ${jwt}` } });
  const legacyBytes = (await rawLegacy.arrayBuffer()).byteLength;
  assert.ok(legacyBytes > 2_097_152);
  const mcp = await listen(t, createHttpServer(config(upstream)));
  const mcpSizes: number[] = [];
  const boundedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const body = await response.arrayBuffer();
    // Synthetic gateway JSON-success buffer. It is deliberately NOT a production-policy claim.
    if (body.byteLength > 2_097_152) throw new Error('synthetic gateway response buffer limit');
    mcpSizes.push(body.byteLength);
    return new Response(body, { status: response.status, headers: response.headers });
  };
  const client = new Client({ name: 'cross-repo-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${mcp}/mcp`), { fetch: boundedFetch }));
  await assert.rejects(client.callTool({ name: 'librechat_api_request', arguments: { path: `/api/messages/${conversationId}/giant` } }), /synthetic gateway response buffer limit/);
  const argsBase = { conversationId, messageId: 'giant' };
  upstreamSizes.length = 0;
  mcpSizes.length = 0;
  const list = output(await client.callTool({ name: 'librechat_messages_list', arguments: { conversationId } }));
  assert.equal(list.consistency, 'live');
  assert.equal(list.conversationId, conversationId);
  assert.deepEqual(list.observability, { llmRequests: 'not_recorded', ptcInnerCalls: 'not_recorded' });
  assert.deepEqual(list.items.map((item: { messageId: string }) => item.messageId), ['giant']);
  assert.equal(list.items[0].content, undefined);
  const meta = output(await client.callTool({ name: 'librechat_messages_list', arguments: argsBase }));
  assert.equal(meta.items[0].parentMessageId, 'branch-root');
  assert.equal(meta.conversationId, conversationId);
  assert.equal(meta.items[0].metadata, undefined);
  assert.equal(meta.items[0].content, undefined);
  const entries = output(await client.callTool({ name: 'librechat_messages_content', arguments: argsBase }));
  assert.equal(entries.items[0].children.omitted, true);
  for (const [field, expected] of [['args', JSON.stringify(args)], ['output', resultText]]) {
    let cursor: string | undefined;
    let offset = 0;
    const chunks: string[] = [];
    do {
      const response = output(await client.callTool({ name: 'librechat_messages_read', arguments: cursor ? { cursor } : { ref: entries.ref, field, index: 0 } }));
      assert.equal(response.error, undefined);
      const body = response;
      assert.equal(body.offsetBytes, offset);
      offset += Buffer.byteLength(body.data);
      chunks.push(body.data);
      cursor = body.nextCursor;
    } while (cursor);
    assert.equal(chunks.join(''), expected);
  }
  assert.ok(upstreamSizes.every((size) => size <= MESSAGE_HTTP_BYTES));
  assert.ok(mcpSizes.every((size) => size <= MESSAGE_MCP_BYTES));
  assert.ok(Math.max(...descriptorResultSizes) < 4096);
  assert.ok(Math.max(...stringResultSizes) < 65_536);
  const nested = output(await client.callTool({ name: 'librechat_messages_content', arguments: { ref: entries.ref, ancestry: [0] } }));
  assert.deepEqual(nested.ancestry, [0]);
  console.log(JSON.stringify({ syntheticLegacyHttpBytes: legacyBytes, maxBoundedUpstreamHttpBytes: Math.max(...upstreamSizes), maxBoundedMcpHttpBytes: Math.max(...mcpSizes), maxDescriptorDbResultBytes: Math.max(...descriptorResultSizes), maxStringDbResultBytes: Math.max(...stringResultSizes), boundedRequests: upstreamSizes.length }));
});
