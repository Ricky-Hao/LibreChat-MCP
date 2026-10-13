import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.js';
import { ApiError } from '../src/client.js';
import { jsonConfigSchema, JSON_CONFIG_LIMITS, validateJsonConfig } from '../src/tools/json-config.js';
import { config, mockApi, output, jwt, type Seen } from './helpers.js';

async function setup(t: TestContext, reply: (request: Seen, response: ServerResponse) => unknown) {
  const upstream = await mockApi(t, reply);
  const server = createMcpServer(config(upstream.origin));
  const client = new Client({ name: 'agent-config-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  return { ...upstream, client, call: (name: string, args: Record<string, unknown>) => client.callTool({ name: `librechat_${name}`, arguments: args }) };
}

function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
const invalid = (value: unknown, nonempty = false) => assert.throws(() => jsonConfigSchema(nonempty).parse(value), (error: unknown) => {
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, 'INVALID_INPUT');
  assert.ok(error.message.length < 220);
  assert.ok(!error.message.includes('PRIVATE_SENTINEL'));
  return true;
});

test('Agent JSON preserves frozen data, shared values and null-prototype data without business filtering', () => {
  const shared = frozen({ versions: ['nested'], approval_revision: 'unchanged-client-epoch' });
  const input = frozen({ future: shared, again: shared, tools: [], tool_options: { empty: {} }, instructionsPrompt: null, model_parameters: {}, no: false, zero: 0, text: '', list: [null, false, 0, '', [], {}], constructor: { prototype: 'ordinary-data' }, toJSON: 'not-a-hook' });
  assert.strictEqual(validateJsonConfig(input), input);
  assert.deepEqual(jsonConfigSchema().parse(input), input);
  const dictionary = Object.assign(Object.create(null), { future: input });
  assert.deepEqual(jsonConfigSchema().parse(dictionary), { future: input });
  assert.deepEqual(jsonConfigSchema().parse({}), {});
  invalid({}, true);
});

test('Agent JSON rejects non-JSON values, accessors, cycles, unsafe keys and proxies without executing user code', () => {
  let calls = 0;
  const getter = Object.defineProperty({}, 'PRIVATE_SENTINEL', { enumerable: true, get() { calls++; throw new Error('PRIVATE_SENTINEL'); } });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const proxy = new Proxy({}, { getPrototypeOf() { calls++; throw new Error('PRIVATE_SENTINEL'); }, ownKeys() { calls++; throw new Error('PRIVATE_SENTINEL'); } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const withHook = { toJSON() { calls++; throw new Error('PRIVATE_SENTINEL'); } };
  const hidden = Object.defineProperty({}, 'PRIVATE_SENTINEL', { value: 1 });
  const symbol = { [Symbol('PRIVATE_SENTINEL')]: 1 };
  const extraArray = Object.assign([], { PRIVATE_SENTINEL: true });
  const protoKey = JSON.parse('{"__proto__":{"PRIVATE_SENTINEL":true}}');
  const before = Object.getOwnPropertyDescriptor(protoKey, '__proto__');
  for (const root of [null, [], true, 0, 'text', undefined, () => 1, getter, cycle, proxy, revoked.proxy, protoKey, new Date(), new (class Config {})()]) invalid(root);
  for (const value of [undefined, () => 1, BigInt(1), Symbol('PRIVATE_SENTINEL'), NaN, Infinity, -Infinity, new Date(), new Map(), new (class Config {})(), getter, cycle, proxy, revoked.proxy, withHook, hidden, symbol, extraArray, new Array(1), protoKey]) invalid({ future: value });
  assert.equal(calls, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptor(protoKey, '__proto__'), before);
  assert.equal(Object.getPrototypeOf(protoKey), Object.prototype);
  assert.equal(Object.hasOwn(Object.prototype, 'PRIVATE_SENTINEL'), false);
});

test('Agent JSON enforces exact depth and node boundaries before serialization', () => {
  const nest = (depth: number) => { let result: Record<string, unknown> = {}; for (let i = 0; i < depth; i++) result = { child: result }; return result; };
  jsonConfigSchema().parse(nest(JSON_CONFIG_LIMITS.depth));
  invalid(nest(JSON_CONFIG_LIMITS.depth + 1));
  const atLimit = { values: Array(JSON_CONFIG_LIMITS.nodes - 2).fill(null) };
  jsonConfigSchema().parse(atLimit);
  invalid({ values: [...atLimit.values, null] });
  // Even invalid values at the far end need not be visited to reject excessive width.
  invalid({ values: Array(JSON_CONFIG_LIMITS.nodes).fill('PRIVATE_SENTINEL') });
});

test('Agent JSON budgets serialized UTF-8 exactly including Chinese, surrogate and control escaping', () => {
  for (const unit of ['a', '中', '😀', '\u0000', '\n', '"', '\\', '\ud800', '\udc00']) {
    const overhead = Buffer.byteLength(JSON.stringify({ value: '' }));
    const unitBytes = Buffer.byteLength(JSON.stringify(unit)) - 2;
    const remaining = JSON_CONFIG_LIMITS.bytes - overhead;
    const value = unit.repeat(Math.floor(remaining / unitBytes)) + 'x'.repeat(remaining % unitBytes);
    const atLimit = { value };
    assert.equal(Buffer.byteLength(JSON.stringify(atLimit)), JSON_CONFIG_LIMITS.bytes);
    jsonConfigSchema().parse(atLimit);
    invalid({ value: value + 'x' });
  }
  const largeKey = '中'.repeat(100);
  const overhead = Buffer.byteLength(JSON.stringify({ [largeKey]: '' }));
  jsonConfigSchema().parse({ [largeKey]: 'x'.repeat(JSON_CONFIG_LIMITS.bytes - overhead) });
  invalid({ [largeKey]: 'x'.repeat(JSON_CONFIG_LIMITS.bytes - overhead + 1) });
});

test('SDK advertises strict Agent envelopes with required open nonrecursive config/changes and unchanged tool count', async (t) => {
  const h = await setup(t, () => ({ id: 'agent_test' }));
  const tools = (await h.client.listTools()).tools;
  assert.equal(tools.length, 56);
  for (const [name, property, required] of [['agents_create', 'config', ['config']], ['agents_update', 'changes', ['id', 'changes']]] as const) {
    const tool = tools.find((item) => item.name === `librechat_${name}`)!;
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.inputSchema.required, required);
    const inner = tool.inputSchema.properties![property] as Record<string, unknown>;
    assert.equal(inner.type, 'object');
    assert.deepEqual(inner.additionalProperties, {});
    assert.equal(inner.properties, undefined);
    assert.equal(inner.minProperties, property === 'changes' ? 1 : undefined);
    assert.ok(!JSON.stringify(tool.inputSchema).includes('$ref'));
    assert.ok(!JSON.stringify(tool.inputSchema).includes('$defs'));
  }
  assert.ok(tools.some((tool) => tool.name === 'librechat_agents_set_skills'));
  assert.equal(h.seen.length, 0);
});

test('real SDK calls send tools/options/future config in one write with no merge, normalization or readback', async (t) => {
  const h = await setup(t, (r, res) => { if (r.method === 'POST') res.statusCode = 201; return { id: 'agent_test', ...r.body, versions: ['HISTORY_ONLY'] }; });
  const body = frozen({ provider: 'openAI', model: 'synthetic-model', model_parameters: { temperature: 0, nested: { versions: [1] } }, tools: ['synthetic_mcp_server'], tool_options: { synthetic_mcp_server: { allowed_callers: [], approval_mode: 'chat', approval_revision: 'c09e8bb4-00fa-41be-90ca-f53f1a0c1f05', run_in_background: false }, empty: {} }, instructionsPrompt: null, subagents: { enabled: false, agent_ids: [] }, skills: [], futureField: { nested: [0, '', null, false], versions: ['keep'] }, constructor: { prototype: 'data' } });
  const snapshot = structuredClone(body);
  for (const [name, args, path, method] of [
    ['agents_create', { config: body }, '/api/agents', 'POST'],
    ['agents_update', { id: 'agent/with space', changes: body }, '/api/agents/agent%2Fwith%20space', 'PATCH'],
  ] as const) {
    const count = h.seen.length;
    const result = await h.call(name, args);
    assert.equal(result.isError, false);
    assert.deepEqual(output(result).data, { id: 'agent_test', ...body });
    assert.equal(h.seen.length, count + 1);
    assert.equal(h.seen.at(-1)!.path, path);
    assert.equal(h.seen.at(-1)!.method, method);
    assert.deepEqual(h.seen.at(-1)!.body, snapshot);
    assert.deepEqual(body, snapshot);
  }
  for (const changes of [{ tool_options: {} }, { model_parameters: {} }, { instructionsPrompt: null }, { name: '' }, { future: null }]) {
    await h.call('agents_update', { id: 'agent_test', changes });
    assert.deepEqual(h.seen.at(-1)!.body, changes);
  }
  await h.call('agents_create', { config: {} });
  assert.deepEqual(h.seen.at(-1)!.body, {}); // Upstream, not the facade, owns required business fields.
  assert.ok(h.seen.every((r) => r.method !== 'GET'));
});

test('SDK rejects invalid Agent JSON and obsolete outer arguments before any upstream request', async (t) => {
  const h = await setup(t, () => ({ id: 'agent_test' }));
  const badKey = JSON.parse('{"__proto__":{"PRIVATE_SENTINEL":true}}');
  for (const [name, args] of [
    ['agents_create', { provider: 'openAI', model: 'old-shape' }],
    ['agents_create', { config: {}, extra: true }],
    ['agents_create', { config: null }], ['agents_create', { config: [] }],
    ['agents_create', { config: badKey }], ['agents_create', { config: { nested: badKey } }],
    ['agents_update', { id: 'agent_test', changes: {} }],
    ['agents_update', { id: '', changes: { future: true } }],
    ['agents_update', { id: 'agent_test', changes: { future: 'PRIVATE_SENTINEL'.repeat(100_000) } }],
    ['agents_update', { id: 'agent_test', changes: { future: true }, config: {} }],
  ] as [string, Record<string, unknown>][]) {
    const result = await h.call(name, args);
    assert.equal(result.isError, true);
    assert.ok(JSON.stringify(result).length < 3000);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
  }
  assert.equal(h.seen.length, 0);
  assert.equal(h.authSeen.length, 0);
});

test('Agent upstream business errors and filtered state stay truthful, redacted, and metadata-only in logs', async (t) => {
  let status = 200;
  const logs: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; });
  const h = await setup(t, (_r, res) => {
    res.statusCode = status;
    return status === 200 ? { id: 'agent_test', tools: [], tool_options: {}, versions: ['HISTORY_ONLY'], apiKey: 'PRIVATE_SENTINEL', current: jwt } : { error: 'upstream_rejection', detail: jwt, apiKey: 'PRIVATE_SENTINEL' };
  });
  const changes = { tools: ['filtered_mcp_server'], tool_options: { filtered_mcp_server: { allowed_callers: ['code_execution'] } }, futureField: 'upstream-may-ignore' };
  const result = await h.call('agents_update', { id: 'agent_test', changes });
  assert.equal(result.isError, false);
  assert.deepEqual(output(result).data, { id: 'agent_test', tools: [], tool_options: {}, apiKey: '[REDACTED]', current: '[REDACTED]' });
  assert.equal(h.seen.length, 1);
  for (const code of [400, 403, 409]) {
    status = code;
    const rejected = await h.call('agents_update', { id: 'agent_test', changes });
    assert.equal(rejected.isError, true);
    assert.equal(output(rejected).error.status, code);
    assert.equal(output(rejected).error.data.error, 'upstream_rejection');
    assert.ok(!JSON.stringify(rejected).includes('PRIVATE_SENTINEL'));
    assert.ok(!JSON.stringify(rejected).includes(jwt));
  }
  assert.equal(h.seen.length, 4);
  const outcomes = logs.map((line) => JSON.parse(line));
  assert.deepEqual(outcomes.map((entry) => entry.outcome), ['ok', 'error', 'error', 'error']);
  for (const entry of outcomes) assert.deepEqual(Object.keys(entry).sort(), ['durationMs', 'outcome', 'tool']);
});
