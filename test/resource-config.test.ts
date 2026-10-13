import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.js';
import { config, mockApi, output, groupId, promptId, jwt, type Seen } from './helpers.js';

async function setup(t: TestContext, reply: (request: Seen, response: ServerResponse) => unknown) {
  const upstream = await mockApi(t, reply);
  const server = createMcpServer(config(upstream.origin));
  const client = new Client({ name: 'resource-config-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  return { ...upstream, client, call: (name: string, args: Record<string, unknown>) => client.callTool({ name: `librechat_${name}`, arguments: args }) };
}
function freeze<T>(input: T): T {
  if (input && typeof input === 'object') { Object.values(input).forEach(freeze); Object.freeze(input); }
  return input;
}
const resource = { _id: groupId, prompt: { _id: promptId }, group: { _id: groupId } };
const cases: Array<{
  name: string; inner: string; outer: Record<string, unknown>; method: string; path: string;
  normal: Record<string, unknown>; body: (input: Record<string, unknown>) => unknown;
}> = [
  { name: 'skills_create', inner: 'config', outer: {}, method: 'POST', path: '/api/skills', normal: { name: 'sample', description: 'synthetic', frontmatter: {} }, body: x => x },
  { name: 'skills_update', inner: 'changes', outer: { id: 'skill/with space', expectedVersion: 7 }, method: 'PATCH', path: '/api/skills/skill%2Fwith%20space', normal: { body: '', alwaysApply: false }, body: x => ({ ...x, expectedVersion: 7 }) },
  { name: 'projects_create', inner: 'config', outer: {}, method: 'POST', path: '/api/projects', normal: { name: ' Project ', instructions: 'synthetic', description: '' }, body: x => x },
  { name: 'projects_update', inner: 'changes', outer: { projectId: groupId }, method: 'PATCH', path: `/api/projects/${groupId}`, normal: { instructions: '', contextRevision: 0 }, body: x => x },
  { name: 'schedules_create', inner: 'config', outer: { clientRequestId: 'synthetic-create' }, method: 'POST', path: '/api/schedules', normal: { name: 'schedule', prompt: 'synthetic', agent_id: 'synthetic_agent', cadence: { frequency: 'daily', hour: 1, minute: 0 }, timezone: 'UTC', chatProjectId: null, file_ids: [] }, body: x => ({ ...x, clientRequestId: 'synthetic-create', enabled: false }) },
  { name: 'schedules_update', inner: 'changes', outer: { id: 'schedule/with space', expectedConfigRevision: 0 }, method: 'PATCH', path: '/api/schedules/schedule%2Fwith%20space', normal: { chatProjectId: null, file_ids: [] }, body: x => ({ ...x, expectedConfigRevision: 0 }) },
  { name: 'prompt_groups_create', inner: 'prompt', outer: { group: { name: 'Synthetic' } }, method: 'POST', path: '/api/prompts', normal: { prompt: ' body ', type: 'text' }, body: x => ({ group: { name: 'Synthetic' }, prompt: x }) },
  { name: 'prompt_groups_update', inner: 'changes', outer: { groupId }, method: 'PATCH', path: `/api/prompts/groups/${groupId}`, normal: { name: 'renamed', command: null }, body: x => x },
  { name: 'prompts_add_version', inner: 'prompt', outer: { groupId }, method: 'POST', path: `/api/prompts/groups/${groupId}/prompts`, normal: { prompt: 'new version', type: 'chat' }, body: x => ({ prompt: x }) },
];

for (const item of cases) test(`${item.name}: open JSON, frozen input, literal payload and one fixed write`, async (t) => {
  const h = await setup(t, () => resource);
  for (const extras of [{}, { futureField: { nil: null, no: false, zero: 0, empty: '', map: {}, array: [], items: [{}], versions: [1], enabled: true, clientRequestId: 'nested-data', expectedConfigRevision: 9, expectedVersion: 9 }, constructor: { prototype: 'ordinary data' } }]) {
    const input = freeze({ ...item.normal, ...extras });
    const args = freeze({ ...item.outer, [item.inner]: input });
    const original = structuredClone(args);
    const before = h.seen.length;
    const result = await h.call(item.name, args);
    assert.equal(result.isError, false);
    assert.deepEqual(output(result).data, resource); // No fabricated all-fields-applied result.
    assert.deepEqual(args, original);
    assert.equal(h.seen.length, before + 1);
    assert.equal(h.seen.at(-1)!.method, item.method);
    assert.equal(h.seen.at(-1)!.path, item.path);
    assert.deepEqual(h.seen.at(-1)!.body, item.body(input));
    assert.equal(Object.hasOwn(h.seen.at(-1)!.body, 'omitted'), false);
  }
  assert.equal(h.authSeen.length, 1);
  assert.ok(h.seen.every(r => r.method !== 'GET' && !r.path.endsWith('/run') && !r.path.endsWith('/production')));
});

test('reserved top-level controls, required outer controls and strict envelopes fail before auth/HTTP', async (t) => {
  const h = await setup(t, () => resource);
  const invalid: Array<[string, Record<string, unknown>]> = [
    ['skills_update', { id: 'skill', changes: { body: 'x' } }],
    ['skills_update', { id: 'skill', expectedVersion: 0, changes: { body: 'x' } }],
    ['skills_update', { id: 'skill', expectedVersion: 7, changes: { expectedVersion: 7, body: 'x' } }],
    ['schedules_create', { config: { name: 'x' } }],
    ['schedules_create', { config: {}, clientRequestId: '' }],
    ['schedules_update', { id: 'schedule', changes: { name: 'x' } }],
    ['schedules_update', { id: 'schedule', expectedConfigRevision: -1, changes: { name: 'x' } }],
    ['projects_update', { projectId: 'bad/id', changes: { instructions: '' } }],
    ['prompts_add_version', { groupId: 'bad/id', prompt: {} }],
  ];
  for (const item of cases) {
    invalid.push([item.name, { ...item.outer, [item.inner]: {}, extra: true }]);
    invalid.push([item.name, { ...item.outer, [item.inner]: [] }]);
    invalid.push([item.name, { ...item.outer, [item.inner]: JSON.parse('{"__proto__":{"PRIVATE_SENTINEL":true}}') }]);
    if (item.inner === 'changes') invalid.push([item.name, { ...item.outer, changes: {} }]);
  }
  for (const [key, value] of [['enabled', false], ['clientRequestId', 'same'], ['expectedConfigRevision', 0]] as const) {
    invalid.push(['schedules_create', { config: { [key]: value }, enabled: false, clientRequestId: 'same' }]);
    invalid.push(['schedules_update', { id: 'schedule', expectedConfigRevision: 0, changes: { name: 'x', [key]: value } }]);
  }
  for (const [name, args] of invalid) {
    const result = await h.call(name, args);
    assert.equal(result.isError, true, name);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
  }
  assert.equal(h.seen.length, 0);
  assert.equal(h.authSeen.length, 0);
});

test('Schedule create sends explicit false/true controls; Skill create has no invented expectedVersion restriction', async (t) => {
  const h = await setup(t, () => resource);
  for (const outer of [{}, { enabled: false }, { enabled: true }]) {
    await h.call('schedules_create', { config: { name: 'synthetic' }, clientRequestId: 'intent', ...outer });
    assert.deepEqual(h.seen.at(-1)!.body, { name: 'synthetic', clientRequestId: 'intent', enabled: 'enabled' in outer ? outer.enabled : false });
  }
  await h.call('skills_create', { config: { expectedVersion: 1, name: 'synthetic', description: 'synthetic' } });
  assert.equal(h.seen.at(-1)!.body.expectedVersion, 1);
  assert.equal(h.seen.length, 4);
});

test('Prompt group creation retains strict metadata/query boundary while revision payload is open', async (t) => {
  const h = await setup(t, () => resource);
  for (const group of [{ name: { $ne: null } }, { name: 'x', future: true }, { name: 'x', author: groupId }, { name: 'x', productionId: promptId }, { name: 'x', $or: [] }]) {
    assert.equal((await h.call('prompt_groups_create', { group, prompt: { prompt: 'x', type: 'text' } })).isError, true);
  }
  assert.equal(h.authSeen.length, 0);
  assert.equal(h.seen.length, 0);
  const tools = (await h.client.listTools()).tools;
  assert.equal(tools.length, 56);
  for (const item of cases) {
    const schema = tools.find(tool => tool.name === `librechat_${item.name}`)!.inputSchema;
    assert.equal(schema.additionalProperties, false);
    assert.ok(schema.required!.includes(item.inner));
    const inner = schema.properties![item.inner] as Record<string, unknown>;
    assert.equal(inner.type, 'object');
    assert.deepEqual(inner.additionalProperties, {});
    assert.equal(inner.minProperties, item.inner === 'changes' ? 1 : undefined);
    assert.ok(!JSON.stringify(schema).includes('$ref'));
  }
  const group = tools.find(tool => tool.name === 'librechat_prompt_groups_create')!.inputSchema.properties!.group as Record<string, unknown>;
  assert.equal(group.additionalProperties, false);
});

test('resource config business 400/403/409 and uncertain Prompt failures retain existing response semantics', async (t) => {
  let status = 400;
  let malformed = false;
  const logs: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; });
  const h = await setup(t, (_r, res) => {
    res.statusCode = status;
    return malformed ? { message: 'Error saving prompt' } : { error: 'business_rejection', current: { version: 8 }, apiKey: 'PRIVATE_SENTINEL', detail: jwt };
  });
  for (const item of cases) for (const code of [400, 403, 409]) {
    status = code;
    const result = await h.call(item.name, { ...item.outer, [item.inner]: item.normal });
    assert.equal(result.isError, true);
    assert.equal(output(result).error.status, code);
    assert.equal(output(result).error.data.current.version, 8);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
    assert.ok(!JSON.stringify(result).includes(jwt));
  }
  status = 200; malformed = true;
  for (const item of cases.filter(item => item.name.includes('prompt'))) {
    const result = await h.call(item.name, { ...item.outer, [item.inner]: item.normal });
    assert.equal(output(result).error.code, 'UNEXPECTED_RESPONSE');
    assert.equal(output(result).error.uncertain, true);
  }
  assert.equal(h.seen.length, 30);
  for (const entry of logs.map(line => JSON.parse(line))) assert.deepEqual(Object.keys(entry).sort(), ['durationMs', 'outcome', 'tool']);
});
