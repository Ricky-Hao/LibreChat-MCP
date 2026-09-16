import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LibreChatClient, type ApiResponse } from '../src/client.js';
import { createMcpServer } from '../src/server.js';
import { agentsTools } from '../src/tools/agents.js';
import { config, mockApi, output, skillId, groupId, promptId, type Seen } from './helpers.js';

const agentId = 'agent_response_test';
const current = {
  id: agentId, _id: '3123456789abcdef01234567', version: 30, updatedAt: '2030-01-01T00:00:00.000Z',
  instructions: 'Current instructions', tools: ['current-tool'], skills: [skillId],
  model_parameters: { temperature: 0.5, version: 'user-version', versions: ['user-setting'], custom: { versions: [1, 2] } },
  extraField: { kept: true },
};
const history = Array.from({ length: 30 }, (_, version) => ({
  version, instructions: 'HISTORY_ONLY ' + '历史指令😀\n'.repeat(800), tools: ['historical-tool'],
}));
const withHistory = { ...current, versions: history };

async function setup(t: TestContext, reply: (r: Seen, res: ServerResponse) => unknown) {
  const upstream = await mockApi(t, reply);
  const server = createMcpServer(config(upstream.origin));
  const client = new Client({ name: 'agent-response-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name: `librechat_${name}`, arguments: args });
  return { call, seen: upstream.seen };
}

const calls = [
  ['agents_get', { id: agentId }, 'GET', `/api/agents/${agentId}/expanded`],
  ['agents_get', { id: agentId, expanded: false }, 'GET', `/api/agents/${agentId}`],
  ['agents_create', { provider: 'openAI', model: 'example' }, 'POST', '/api/agents'],
  ['agents_update', { id: agentId, changes: { name: 'renamed' } }, 'PATCH', `/api/agents/${agentId}`],
  ['agents_set_skills', { id: agentId, skills: [skillId], scope: 'selected' }, 'PATCH', `/api/agents/${agentId}`],
] as const;

test('current Agent tools trim only top-level history in actual MCP content, without extra requests', async (t) => {
  let includeHistory = true;
  const h = await setup(t, (r, res) => {
    if (r.path.endsWith('/versions')) return history;
    if (r.method === 'POST') res.statusCode = 201;
    // Creation does not synthesize a scalar version upstream; do not invent one here either.
    const { version, ...created } = current;
    return { ...(r.method === 'POST' ? created : current), ...(includeHistory && { versions: history }) };
  });
  for (const present of [true, false]) {
    includeHistory = present;
    for (const [name, args, method, path] of calls) {
      const before = h.seen.length;
      const result = await h.call(name, args);
      const { version, ...created } = current;
      assert.equal(result.isError, false);
      assert.deepEqual(output(result), { status: method === 'POST' ? 201 : 200, data: method === 'POST' ? created : current });
      assert.equal(JSON.stringify(result).includes('HISTORY_ONLY'), false);
      // The server currently emits only text; a future structured channel must also be reviewed.
      assert.equal(result.structuredContent, undefined);
      assert.equal(h.seen.length, before + 1);
      assert.equal(h.seen.at(-1)!.method, method);
      assert.equal(h.seen.at(-1)!.path, path);
      if (name === 'agents_create') assert.deepEqual(h.seen.at(-1)!.body, { provider: 'openAI', model: 'example' });
      if (name === 'agents_update') assert.deepEqual(h.seen.at(-1)!.body, { name: 'renamed' });
      if (name === 'agents_set_skills') assert.deepEqual(h.seen.at(-1)!.body, { skills: [skillId], skills_scope: 'selected' });
    }
  }
  assert.deepEqual(output(await h.call('agents_versions', { id: agentId })).data, history);
  includeHistory = true;
  // Generic forwarding is an unchanged, real MCP serialization baseline, not a token estimate.
  const beforeComparison = h.seen.length;
  const raw = await h.call('api_request', { method: 'PATCH', path: `/api/agents/${agentId}`, body: { name: 'renamed' } });
  assert.deepEqual(output(raw).data, withHistory);
  const trimmed = await h.call('agents_update', { id: agentId, changes: { name: 'renamed' } });
  assert.equal(h.seen.length, beforeComparison + 2); // One PATCH for each explicit mock comparison call.
  assert.deepEqual(h.seen.at(-1)!.body, h.seen.at(-2)!.body);
  const beforeBytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  const afterBytes = Buffer.byteLength(JSON.stringify(trimmed), 'utf8');
  assert.ok(afterBytes < beforeBytes / 10);
  t.diagnostic(`Synthetic 30-version MCP result, UTF-8 JSON bytes: ${beforeBytes} -> ${afterBytes}; ${(100 * (1 - afterBytes / beforeBytes)).toFixed(2)}% smaller. Not a token/performance measurement.`);
});

test('parameter merge, Skill/Schedule concurrency fields and Prompt history semantics remain unchanged', async (t) => {
  const skill = { _id: skillId, version: 8 };
  const schedule = { id: 'sched_test', configRevision: 2 };
  const prompts = [{ _id: promptId, groupId, prompt: 'version 1' }, { _id: skillId, groupId, prompt: 'version 2' }];
  const group = { _id: groupId, productionId: promptId };
  const h = await setup(t, (r) => {
    if (r.path.startsWith('/api/skills')) return skill;
    if (r.path.startsWith('/api/schedules')) return schedule;
    if (r.path.startsWith('/api/prompts/groups/')) return group;
    if (r.path.startsWith('/api/prompts?')) return prompts;
    return withHistory;
  });
  const changes = { model_parameters: { temperature: 0.8 } };
  assert.deepEqual(output(await h.call('agents_update', { id: agentId, changes })).data, current);
  assert.equal(h.seen.length, 2); // The existing merge pre-read plus one PATCH, no history/read-back fetch.
  assert.deepEqual(h.seen[1].body, { model_parameters: { ...current.model_parameters, temperature: 0.8 } });
  assert.deepEqual(output(await h.call('skills_update', { id: skillId, expectedVersion: 7, changes: { body: 'changed' } })).data, skill);
  assert.deepEqual(h.seen.at(-1)!.body, { expectedVersion: 7, body: 'changed' });
  assert.deepEqual(output(await h.call('schedules_update', { id: 'sched_test', expectedConfigRevision: 1, changes: { name: 'changed' } })).data, schedule);
  assert.deepEqual(h.seen.at(-1)!.body, { expectedConfigRevision: 1, name: 'changed' });
  assert.deepEqual(output(await h.call('prompts_list', { groupId })).data, prompts);
  assert.deepEqual(output(await h.call('prompt_groups_get', { groupId })).data, group);
  assert.equal(h.seen.length, 6);
});

test('errors, empty bodies and unexpected shapes keep existing status and diagnostic behavior', async (t) => {
  let status = 500;
  let data: unknown = { id: agentId, error: 'diagnostic', versions: ['diagnostic history'] };
  const h = await setup(t, (_r, res) => { res.statusCode = status; if (status === 204) res.end(); else return data; });
  for (const [name, args] of calls) {
    const before = h.seen.length;
    const result = await h.call(name, args);
    assert.equal(result.isError, true);
    assert.equal(output(result).error.status, 500);
    assert.deepEqual(output(result).error.data, data);
    assert.equal(h.seen.length, before + 1); // No retry on an uncertain 5xx write.
  }
  status = 204;
  assert.deepEqual(output(await h.call('agents_get', { id: agentId })), { status: 204, data: null });
  status = 200;
  for (const unexpected of [null, [], 'plain diagnostic', { versions: ['unknown'] }, { agent: withHistory },
    { id: agentId, versions: 'not an array' }, { id: agentId, error: 'denied', versions: ['diagnostic'] },
    { id: agentId, message: 'error detail', versions: ['diagnostic'] }]) {
    data = unexpected;
    const baseline = await h.call('api_request', { path: `/api/agents/${agentId}/expanded` });
    // Clipping must not reinterpret a 2xx diagnostic as a current Agent or change existing error handling.
    assert.deepEqual(await h.call('agents_get', { id: agentId }), baseline);
  }
});

function freeze(value: unknown): void {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
}

test('response projection does not mutate frozen upstream objects or shared nested references', async (t) => {
  const api = new LibreChatClient(config('http://127.0.0.1:1'));
  const handlers = new Map<string, (args: any) => Promise<unknown>>();
  agentsTools((name, _description, _shape, run) => { handlers.set(name, run); }, api);
  const raw = { status: 200, data: withHistory };
  const snapshot = structuredClone(raw);
  freeze(raw);
  let response: ApiResponse = raw;
  const request = t.mock.method(api, 'request', async () => response);
  for (const [name, args] of calls) {
    const result = await handlers.get(name)!(args) as ApiResponse<typeof current>;
    assert.notStrictEqual(result, raw);
    assert.deepEqual(result.data, current);
    assert.strictEqual(result.data.model_parameters, raw.data.model_parameters);
    assert.strictEqual(result.data.tools, raw.data.tools);
  }
  assert.deepEqual(raw, snapshot);
  assert.equal(request.mock.callCount(), calls.length);
  for (const unchanged of [{ status: 200, data: current }, { status: 500, data: withHistory }]) {
    response = unchanged;
    assert.strictEqual(await handlers.get('agents_get')!({ id: agentId, expanded: true }), unchanged);
  }
});
