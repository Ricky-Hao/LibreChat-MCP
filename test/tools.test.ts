import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.js';
import { mockApi, config, skillId, groupId, promptId, output, type Seen } from './helpers.js';
import type { ServerResponse } from 'node:http';

async function setup(t: TestContext, reply: (r: Seen, res: ServerResponse) => unknown) {
  const upstream = await mockApi(t, reply);
  const server = createMcpServer(config(upstream.origin));
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name: `librechat_${name}`, arguments: args });
  const last = () => upstream.seen.at(-1)!;
  return { call, last, seen: upstream.seen };
}

test('Skills CRUD, cursor paging, expectedVersion conflict, readonly source and multipart files', async (t) => {
  let source = 'inline';
  const h = await setup(t, (r, res) => {
    if (source === 'deployment' && r.method !== 'GET') { res.statusCode = 403; return { message: 'Deployment skills are read-only' }; }
    if (r.path.startsWith('/api/skills?')) return { skills: [{ _id: skillId, version: 7 }], has_more: true, after: 'next-cursor' };
    if (r.method === 'PATCH' && r.body.expectedVersion !== 7) {
      res.statusCode = 409; return { error: 'skill_version_conflict', current: { version: 7 } };
    }
    if (r.path === '/api/settings/skills/active' && r.method === 'GET') return { [groupId]: false };
    return { _id: skillId, source, version: 8, ...typeof r.body === 'object' && r.body };
  });
  const list = output(await h.call('skills_list', { limit: 2, cursor: 'old', search: 'test' }));
  assert.equal(list.data.after, 'next-cursor');
  assert.match(h.last().path, /cursor=old/);
  await h.call('skills_create', { name: 'test', description: 'a description', body: 'hello' });
  assert.equal(h.last().method, 'POST');
  assert.equal(h.last().path, '/api/skills');
  await h.call('skills_update', { id: skillId, expectedVersion: 7, changes: { body: 'new' } });
  assert.deepEqual(h.last().body, { body: 'new', expectedVersion: 7 });
  const conflict = await h.call('skills_update', { id: skillId, expectedVersion: 6, changes: { body: 'stale' } });
  assert.equal(conflict.isError, true);
  assert.equal(output(conflict).error.data.current.version, 7);
  source = 'github';
  assert.equal((await h.call('skills_update', { id: skillId, expectedVersion: 7, changes: { body: 'sync source edit' } })).isError, false);
  source = 'deployment';
  assert.equal(output(await h.call('skills_delete', { id: skillId })).error.status, 403);
  source = 'inline';
  await h.call('skills_files_list', { id: skillId });
  assert.equal(h.last().path, `/api/skills/${skillId}/files`);
  await h.call('skills_file_read', { id: skillId, path: 'references/guide.md' });
  assert.equal(h.last().path, `/api/skills/${skillId}/files/references/guide.md`);
  await h.call('skills_file_upload', { id: skillId, path: 'references/guide.md', content: '# Guide' });
  assert.match(h.last().headers['content-type']!, /multipart\/form-data/);
  assert.match(h.last().body, /# Guide/);
  assert.match(h.last().body, /references\/guide.md/);
  await h.call('skills_file_delete', { id: skillId, path: 'references/guide.md' });
  assert.equal(h.last().method, 'DELETE');
  await h.call('skills_set_enabled', { id: skillId, enabled: true });
  assert.deepEqual(h.last().body, { skillStates: { [groupId]: false, [skillId]: true } });
  await h.call('skills_delete', { id: skillId });
  assert.equal(h.last().method, 'DELETE');
});

test('Agent changes do not replay unrelated fields, parameters merge, Skill binding remains separate', async (t) => {
  const h = await setup(t, () => ({ id: 'agent_test', model_parameters: { temperature: 0.5, top_p: 0.9 }, tools: ['keep'], instructions: 'keep' }));
  await h.call('agents_list', { promoted: true });
  assert.equal(h.last().path, '/api/agents?promoted=1');
  await h.call('agents_create', { provider: 'openAI', model: 'model-test', name: 'test' });
  assert.equal(h.last().path, '/api/agents');
  assert.equal(h.last().method, 'POST');
  await h.call('agents_update', { id: 'agent_test', changes: { name: 'new name' } });
  assert.deepEqual(h.last().body, { name: 'new name' });
  await h.call('agents_update', { id: 'agent_test', changes: { model_parameters: { temperature: 0.8 } } });
  assert.deepEqual(h.last().body, { model_parameters: { temperature: 0.8, top_p: 0.9 } });
  await h.call('agents_set_skills', { id: 'agent_test', skills: [skillId], scope: 'selected' });
  assert.deepEqual(h.last().body, { skills: [skillId], skills_scope: 'selected' });
  for (const [name, suffix, method] of [['agents_get', '/expanded', 'GET'], ['agents_versions', '/versions', 'GET'], ['agents_delete', '', 'DELETE']]) {
    await h.call(name, { id: 'agent_test' });
    assert.equal(h.last().path, `/api/agents/agent_test${suffix}`);
    assert.equal(h.last().method, method);
  }
});

test('Schedule cadence and concurrency map literally; run-now is explicit and deletion retains 202', async (t) => {
  const h = await setup(t, (r, res) => {
    if (r.method === 'DELETE') res.statusCode = 202;
    return { id: 'sched_test', configRevision: 2, nextRunAt: '2030-01-01T00:00:00.000Z' };
  });
  await h.call('schedules_create', {
    name: 'test', prompt: 'hello', agent_id: 'agent_test', timezone: 'Asia/Shanghai',
    cadence: { frequency: 'cron', expression: '0 9 * * 1-5' }, clientRequestId: 'create-test-1',
  });
  assert.equal(h.last().path, '/api/schedules');
  assert.equal(h.last().body.enabled, false);
  assert.deepEqual(h.last().body.cadence, { frequency: 'cron', expression: '0 9 * * 1-5' });
  await h.call('schedules_update', { id: 'sched_test', expectedConfigRevision: 2, changes: { name: 'renamed' } });
  assert.deepEqual(h.last().body, { name: 'renamed', expectedConfigRevision: 2 });
  await h.call('schedules_set_enabled', { id: 'sched_test', expectedConfigRevision: 3, enabled: true });
  assert.deepEqual(h.last().body, { enabled: true, expectedConfigRevision: 3 });
  assert.equal(h.seen.some((r) => r.path.endsWith('/run')), false);
  await h.call('schedules_run_now', { id: 'sched_test' });
  assert.equal(h.last().path, '/api/schedules/sched_test/run');
  assert.equal(h.last().method, 'POST');
  assert.equal(output(await h.call('schedules_delete', { id: 'sched_test' })).status, 202);
});

test('Prompt content appends versions, production is separate, and HTTP 200 application errors are not success', async (t) => {
  let fail = false;
  const h = await setup(t, (r) => {
    if (fail) return { message: 'Error saving prompt' };
    if (r.path.endsWith('/tags/production')) return { message: 'Prompt production made successfully' };
    if (r.path.includes(`/groups/${groupId}`) && r.method === 'GET') return { _id: groupId, productionId: promptId };
    if (r.method === 'PATCH') return { _id: groupId };
    if (r.path.includes('/groups?')) return { promptGroups: [], has_more: false, after: null };
    if (r.path.includes('?groupId=')) return [];
    if (r.method === 'GET') return { _id: promptId, groupId };
    return { prompt: { _id: promptId, groupId }, group: { _id: groupId } };
  });
  await h.call('prompt_groups_list');
  assert.equal(h.last().path, '/api/prompts/groups?limit=20');
  await h.call('prompt_groups_create', { group: { name: 'Test' }, prompt: { type: 'text', prompt: 'v1' } });
  assert.equal(h.last().path, '/api/prompts');
  await h.call('prompt_groups_update', { groupId, changes: { name: 'new' } });
  assert.deepEqual(h.last().body, { name: 'new' });
  await h.call('prompts_add_version', { groupId, prompt: { type: 'text', prompt: '  v2\n' } });
  assert.equal(h.last().body.prompt.prompt, '  v2\n');
  assert.equal(h.last().path, `/api/prompts/groups/${groupId}/prompts`);
  assert.equal(h.last().method, 'POST');
  assert.equal(h.seen.some((r) => r.path.endsWith('/tags/production')), false);
  const madeDefault = output(await h.call('prompts_set_default', { promptId }));
  assert.equal(madeDefault.current.productionId, promptId);
  await h.call('prompts_delete', { promptId, groupId });
  assert.equal(h.last().path, `/api/prompts/${promptId}?groupId=${groupId}`);
  await h.call('prompt_groups_delete', { groupId });
  assert.equal(h.last().path, `/api/prompts/groups/${groupId}`);
  fail = true;
  assert.equal((await h.call('prompts_add_version', { groupId, prompt: { type: 'text', prompt: 'v3' } })).isError, true);
});

test('visibility, named sharing and unrestricted generic writes are available by default', async (t) => {
  const h = await setup(t, () => ({ public: true, principals: [] }));
  await h.call('visibility_set', { resourceType: 'skill', resourceId: skillId, public: true });
  assert.deepEqual(h.seen.at(-2)!.body, { public: true, publicAccessRoleId: 'skill_viewer' });
  assert.equal(h.last().method, 'GET'); // read-back, not fake acknowledgement
  await h.call('permissions_update', { resourceType: 'promptGroup', resourceId: groupId, updated: [{ type: 'user', id: skillId, accessRoleId: 'promptGroup_editor' }] });
  assert.equal(h.seen.at(-2)!.body.public, undefined);
  assert.equal(h.seen.at(-2)!.body.updated[0].accessRoleId, 'promptGroup_editor');
  await h.call('api_request', { method: 'DELETE', path: '/api/future-resource/anything', body: { future: true } });
  assert.equal(h.last().method, 'DELETE');
  assert.deepEqual(h.last().body, { future: true });
});
