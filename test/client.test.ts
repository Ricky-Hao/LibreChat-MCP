import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibreChatClient, ApiError, redact } from '../src/client.js';
import { loadConfig, configSchema, DEFAULT_USER_AGENT } from '../src/config.js';
import { mockApi, config, jwt, refreshToken } from './helpers.js';

test('JSON configuration, defaults and non-leaking errors', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'librechat-mcp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  await assert.rejects(loadConfig(path), /Cannot read configuration/);
  await writeFile(path, JSON.stringify({ baseUrl: 'http://localhost:3080', refreshToken }));
  assert.equal((await loadConfig(path)).transport, 'http');
  assert.equal((await loadConfig(path)).authToken, undefined);
  assert.equal((await loadConfig(path)).userAgent, DEFAULT_USER_AGENT);
  assert.equal(configSchema.safeParse({ baseUrl: 'file:///tmp', refreshToken }).success, false);
  assert.equal(configSchema.safeParse({ baseUrl: 'http://localhost', jwt }).success, false); // no legacy jwt configuration
  await writeFile(path, JSON.stringify({ baseUrl: 'http://localhost', refreshToken: { secret: refreshToken } }));
  await assert.rejects(loadConfig(path), (e: Error) => e.message.includes('refreshToken') && !e.message.includes(refreshToken));
});

test('generic forwarding supports new routes, query arrays, arbitrary JSON, headers and base prefixes', async (t) => {
  const upstream = await mockApi(t, (r) => r.body);
  const api = new LibreChatClient(config(`${upstream.origin}/librechat/`));
  assert.deepEqual((await api.request({
    method: 'POST', path: '/api/new-in-dev', query: { tag: ['a', 'b'], limit: 2 },
    headers: { 'x-custom': 'test' }, body: { futureField: [1, true] },
  })).data, { futureField: [1, true] });
  assert.equal(upstream.seen[0].path, '/librechat/api/new-in-dev?tag=a&tag=b&limit=2');
  assert.equal(upstream.seen[0].headers.authorization, `Bearer ${jwt}`);
  assert.equal(upstream.seen[0].headers['x-custom'], 'test');
});

test('configured/default User-Agent is sent on refresh and API replays; explicit header overrides only that request', async (t) => {
  for (const userAgent of [DEFAULT_USER_AGENT, 'CustomBrowser/1.0']) {
    const upstream = await mockApi(t, (_r, res) => { res.statusCode = 401; return {}; });
    const settings = userAgent === DEFAULT_USER_AGENT ? config(upstream.origin) : configSchema.parse({ ...config(upstream.origin), userAgent });
    const api = new LibreChatClient(settings);
    await assert.rejects(api.request({ path: '/api/test' }), (e: ApiError) => e.status === 401);
    assert.equal(upstream.authSeen.length, 2);
    assert.equal(upstream.seen.length, 2);
    for (const request of [...upstream.authSeen, ...upstream.seen]) assert.equal(request.headers['user-agent'], userAgent);
    await assert.rejects(api.request({ path: '/api/test', headers: { 'UsEr-AgEnT': 'OverrideBrowser/2.0' } }), (e: ApiError) => e.status === 401);
    assert.equal(upstream.authSeen.at(-1)!.headers['user-agent'], userAgent);
    for (const request of upstream.seen.slice(-2)) assert.equal(request.headers['user-agent'], 'OverrideBrowser/2.0');
  }
});

test('absolute external requests are allowed but do not inherit configured JWT; redirects are not followed', async (t) => {
  const other = await mockApi(t, () => ({ ok: true }));
  const upstream = await mockApi(t, (_r, res) => { res.statusCode = 302; res.setHeader('location', `${other.origin}/redirected`); return {}; });
  const api = new LibreChatClient(config(upstream.origin));
  await api.request({ path: `${other.origin}/external` });
  assert.equal(other.seen[0].headers.authorization, undefined);
  await assert.rejects(api.request({ path: '/redirect' }), (e: ApiError) => e.status === 302);
  assert.equal(other.seen.length, 1);
});

test('upstream errors preserve status/conflict; only explicit 401 writes get one replay', async (t) => {
  for (const status of [401, 403, 404, 409, 429, 500]) {
    const upstream = await mockApi(t, (_r, res) => { res.statusCode = status; return { current: { version: 7 } }; });
    await assert.rejects(new LibreChatClient(config(upstream.origin)).request({ method: 'PATCH', path: '/api/skills/id', body: { expectedVersion: 6 } }), (e: ApiError) => {
      assert.equal(e.status, status);
      assert.deepEqual(e.data, { current: { version: 7 } });
      if (status === 401) assert.match(e.message, /rejected after refresh/);
      assert.equal(e.uncertain, status >= 500);
      return true;
    });
    assert.equal(upstream.seen.length, status === 401 ? 2 : 1);
    assert.equal(upstream.authSeen.length, status === 401 ? 2 : 1);
  }
});

test('interrupted writes report uncertainty without retry or leaked credentials', async (t) => {
  const upstream = await mockApi(t, (_r, res) => { res.destroy(); });
  await assert.rejects(new LibreChatClient(config(upstream.origin)).request({ method: 'POST', path: '/create', body: {} }), (e: ApiError) => e.uncertain && !e.message.includes(jwt));
  assert.equal(upstream.seen.length, 1);
  const slow = await mockApi(t, () => undefined);
  await assert.rejects(new LibreChatClient({ ...config(slow.origin), timeoutMs: 25 }).request({ path: '/slow' }), (e: ApiError) => e.code === 'NETWORK_ERROR' && !e.uncertain);
  assert.deepEqual(redact({ jwt, instructions: `before ${jwt} after`, api_key: 'secret', nested: [{ client_secret: 'secret' }], token: 'newly-issued-token', tempToken: '2fa-token' }, [jwt]), {
    jwt: '[REDACTED]', instructions: 'before [REDACTED] after', api_key: '[REDACTED]', nested: [{ client_secret: '[REDACTED]' }], token: '[REDACTED]', tempToken: '[REDACTED]',
  });
  const chain = await mockApi(t, () => ({}));
  const api = new LibreChatClient(config(chain.origin));
  const controller = new AbortController();
  await assert.rejects(api.withSignal(controller.signal, async () => {
    await api.request({ path: '/read-before-patch' });
    controller.abort();
    await api.request({ method: 'PATCH', path: '/must-not-run', body: {} });
  }), (e: ApiError) => e.code === 'CANCELLED' && !e.uncertain);
  assert.equal(chain.seen.length, 1);
});
