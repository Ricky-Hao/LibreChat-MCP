import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createHttpServer } from '../src/http.js';
import { mockApi, listen, config, jwt, skillId, output } from './helpers.js';

const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

test('real Streamable HTTP initialize, discovery, tool call, redaction, health and protocol errors', async (t) => {
  const upstream = await mockApi(t, () => ({ _id: skillId, body: `hello ${jwt}`, api_key: 'do-not-return', version: 1 }));
  const origin = await listen(t, createHttpServer(config(upstream.origin)));
  const client = new Client({ name: 'http-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
  assert.equal(client.getServerVersion()?.name, 'librechat-mcp');
  const { tools } = await client.listTools();
  assert.ok(tools.length >= 35);
  for (const name of ['skills_update', 'agents_set_skills', 'schedules_run_now', 'prompts_add_version', 'visibility_set', 'api_request']) {
    assert.ok(tools.some((tool) => tool.name === `librechat_${name}`));
  }
  const logs: string[] = [];
  const stderr = t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; });
  const result = await client.callTool({ name: 'librechat_skills_get', arguments: { id: skillId } });
  stderr.mock.restore();
  assert.equal(result.isError, false);
  assert.equal(output(result).data.body, 'hello [REDACTED]');
  assert.equal(JSON.stringify(result).includes(jwt), false);
  assert.equal(JSON.stringify(logs).includes(jwt), false);
  assert.equal(JSON.stringify(logs).includes('hello'), false);
  assert.equal(upstream.seen[0].headers.authorization, `Bearer ${jwt}`);
  const before = upstream.seen.length;
  const invalid = await client.callTool({ name: 'librechat_skills_update', arguments: { id: skillId, expectedVersion: 'bad', changes: {} } });
  assert.equal(invalid.isError, true);
  assert.equal(upstream.seen.length, before);
  assert.deepEqual(await (await fetch(`${origin}/healthz`)).json(), { status: 'ok' });
  assert.equal(upstream.seen.length, before);
  const malformed = await fetch(`${origin}/mcp`, { method: 'POST', headers, body: '{' });
  assert.equal(malformed.status, 400);
  const unknown = await fetch(`${origin}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 55, method: 'unknown/method' }) });
  assert.equal((await unknown.json() as any).error.code, -32601);
  assert.equal((await fetch(`${origin}/mcp`)).status, 405);
});

test('optional downstream bearer is separate from upstream credential', async (t) => {
  const upstream = await mockApi(t, () => ({}));
  const origin = await listen(t, createHttpServer({ ...config(upstream.origin), authToken: 'test-only-downstream-token' }));
  assert.equal((await fetch(`${origin}/mcp`, { method: 'POST', headers, body: '{}' })).status, 401);
  const client = new Client({ name: 'auth-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { Authorization: 'Bearer test-only-downstream-token' } } }));
  await client.callTool({ name: 'librechat_api_request', arguments: { path: '/api/new' } });
  assert.equal(upstream.seen[0].headers.authorization, `Bearer ${jwt}`);
});

test('CLI stdio initializes, discovers and calls a tool without stdout log contamination', async (t) => {
  const upstream = await mockApi(t, () => ({ ok: true }));
  const dir = await mkdtemp(join(tmpdir(), 'librechat-mcp-stdio-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify(config(upstream.origin)), { mode: 0o600 });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/cli.ts', '--config', path, '--transport', 'stdio'], stderr: 'pipe' });
  const logs: string[] = [];
  transport.stderr?.on('data', (data) => logs.push(String(data)));
  const client = new Client({ name: 'stdio-test', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  assert.ok((await client.listTools()).tools.length >= 35);
  const result = await client.callTool({ name: 'librechat_api_request', arguments: { path: '/api/new' } });
  assert.equal(output(result).data.ok, true);
  assert.equal(logs.join('').includes(jwt), false);
});
