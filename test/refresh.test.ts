import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LibreChatClient, ApiError } from '../src/client.js';
import { loadConfig, refreshTokenWriter } from '../src/config.js';
import { createHttpServer } from '../src/http.js';
import { mockApi, config, refreshToken, output, listen } from './helpers.js';

const access = (n: number) => `test-only-access-token-${n}`;
const refresh = (n: number) => `test-only-rotated-cookie-${n}`;

test('refresh-only bootstrap, 401 replay, rotated cookie persistence and restart', async (t) => {
  let generation = 0;
  let expectedCookie = refreshToken;
  let rejectOld = false;
  const upstream = await mockApi(t, (r, res) => {
    if (r.path === '/prefix/api/auth/refresh') {
      assert.equal(r.method, 'POST');
      assert.equal(r.headers.authorization, undefined);
      assert.equal(r.headers.cookie, `refreshToken=${expectedCookie}; token_provider=librechat`);
      generation++;
      expectedCookie = refresh(generation);
      res.setHeader('set-cookie', ['token_provider=librechat; HttpOnly', `refreshToken=${expectedCookie}; Expires=Sun, 01 Jan 2034 00:00:00 GMT; HttpOnly`]);
      return { token: access(generation) };
    }
    if (rejectOld && r.headers.authorization === `Bearer ${access(1)}`) { res.statusCode = 401; return {}; }
    assert.equal(r.headers.authorization, `Bearer ${access(generation)}`);
    return { body: r.body };
  }, false);
  const dir = await mkdtemp(join(tmpdir(), 'librechat-refresh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({ ...config(`${upstream.origin}/prefix`), port: 4321 }));
  const api = new LibreChatClient(await loadConfig(path), refreshTokenWriter(path));
  await api.request({ method: 'POST', path: '/api/auth/2fa/enable', body: { name: 'first' } });
  assert.equal(upstream.authSeen.length, 1);
  rejectOld = true;
  await api.request({ method: 'PATCH', path: '/api/new/id', body: { name: 'updated' } });
  assert.equal(upstream.authSeen.length, 2);
  const patches = upstream.seen.filter((r) => r.method === 'PATCH');
  assert.equal(patches.length, 2);
  assert.deepEqual(patches[0].body, patches[1].body);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.refreshToken, refresh(2));
  assert.equal(saved.jwt, undefined);
  assert.equal(saved.port, 4321);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(dir), ['config.json']);
  await new LibreChatClient(await loadConfig(path), refreshTokenWriter(path)).request({ path: '/api/new' });
  assert.equal(upstream.authSeen.length, 3);
});

test('stateless HTTP calls share refresh; delayed old 401 does not rotate again; outputs/logs redact new credentials', async (t) => {
  let generation = 0;
  let expire = false;
  const upstream = await mockApi(t, async (r, res) => {
    if (r.path === '/api/auth/refresh') {
      await sleep(20);
      generation++;
      res.setHeader('set-cookie', `refreshToken=${refresh(generation)}; HttpOnly`);
      return { token: access(generation) };
    }
    if (expire && r.headers.authorization === `Bearer ${access(1)}`) {
      if (r.path.endsWith('/slow')) await sleep(80);
      res.statusCode = 401;
      return { message: access(1) };
    }
    return { message: `${access(generation)} ${refresh(generation)} ${refreshToken}` };
  }, false);
  const origin = await listen(t, createHttpServer(config(upstream.origin)));
  const client = new Client({ name: 'refresh-http-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
  const logs: string[] = [];
  const stderr = t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; });
  const call = (path: string) => client.callTool({ name: 'librechat_api_request', arguments: { path } });
  await Promise.all(['/api/a', '/api/b', '/api/c'].map(call));
  assert.equal(upstream.authSeen.length, 1);
  expire = true;
  const results = await Promise.all(['/api/fast', '/api/slow', '/api/other'].map(call));
  assert.equal(upstream.authSeen.length, 2);
  for (const result of results) {
    assert.equal(result.isError, false);
    assert.equal(output(result).data.message, '[REDACTED] [REDACTED] [REDACTED]');
  }
  stderr.mock.restore();
  for (const secret of [access(1), access(2), refresh(1), refresh(2), refreshToken]) assert.equal(logs.join('').includes(secret), false);
});

test('custom authentication, cookies, external URLs and the refresh endpoint do not trigger managed refresh', async (t) => {
  const upstream = await mockApi(t, (_r, res) => { res.statusCode = 401; return {}; }, false);
  const other = await mockApi(t, (_r, res) => { res.statusCode = 401; return {}; }, false);
  const api = new LibreChatClient(config(upstream.origin));
  await assert.rejects(api.request({ path: '/api/custom', headers: { Authorization: 'Bearer custom-token' } }));
  await assert.rejects(api.request({ path: '/api/custom', headers: { Cookie: 'custom=session' } }));
  await assert.rejects(api.request({ path: `${other.origin}/api/custom` }));
  assert.equal(upstream.authSeen.length, 0);
  await assert.rejects(api.request({ path: '/api/auth/refresh', method: 'POST' }));
  assert.equal(upstream.authSeen.length, 1); // explicit refresh endpoint call, no recursive auto refresh
  assert.equal(upstream.seen.length, 3);
  assert.equal(other.seen[0].headers.authorization, undefined);
  assert.equal(other.seen[0].headers.cookie, undefined);
});

test('failed/malformed/interrupted refresh is not retried and never leaks its response', async (t) => {
  for (const failure of ['403', 'malformed', 'disconnect', 'missing-cookie']) {
    const upstream = await mockApi(t, (_r, res) => {
      if (failure === 'disconnect') { res.destroy(); return; }
      if (failure === '403') res.statusCode = 403;
      if (failure === 'malformed') res.setHeader('set-cookie', `refreshToken=${refresh(1)}`);
      return { message: 'sensitive-upstream-detail', token: failure === 'missing-cookie' ? access(1) : '' };
    }, false);
    await assert.rejects(new LibreChatClient(config(upstream.origin)).request({ method: 'POST', path: '/api/new', body: {} }), (e: ApiError) => {
      assert.equal(e.code, 'AUTH_REFRESH_FAILED');
      assert.equal(e.data, undefined);
      assert.equal(e.message.includes('sensitive-upstream-detail'), false);
      return true;
    });
    assert.equal(upstream.seen.length, 1);
    assert.equal(upstream.authSeen.length, 1); // business POST was never sent
  }
});

test('failed config save retains rotated credentials and next call retries saving, not refresh', async (t) => {
  const upstream = await mockApi(t, (r, res) => {
    if (r.path === '/api/auth/refresh') {
      res.setHeader('set-cookie', `refreshToken=${refresh(1)}`);
      return { token: access(1) };
    }
    assert.equal(r.headers.authorization, `Bearer ${access(1)}`);
    return {};
  }, false);
  let saves = 0;
  const api = new LibreChatClient(config(upstream.origin), async (token) => {
    assert.equal(token, refresh(1));
    if (++saves === 1) throw new Error('readonly');
  });
  await assert.rejects(api.request({ path: '/api/new' }), (e: ApiError) => e.code === 'AUTH_PERSIST_FAILED');
  assert.equal(upstream.seen.length, 1);
  await api.request({ path: '/api/new' });
  assert.equal(upstream.authSeen.length, 1);
  assert.equal(saves, 2);
  assert.equal(upstream.seen.length, 2);
});

test('cancelling one waiter does not cancel rotation/save or replay its business write', async (t) => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const upstream = await mockApi(t, async (r, res) => {
    if (r.path === '/api/auth/refresh') {
      enter(); await released;
      res.setHeader('set-cookie', `refreshToken=${refresh(1)}`);
      return { token: access(1) };
    }
    return {};
  }, false);
  let saved = false;
  const api = new LibreChatClient(config(upstream.origin), async () => { saved = true; });
  const abort = new AbortController();
  const cancelled = assert.rejects(api.withSignal(abort.signal, () => api.request({ method: 'POST', path: '/api/cancelled' })), (e: ApiError) => e.code === 'CANCELLED');
  await entered;
  const other = api.request({ path: '/api/other' });
  abort.abort();
  release();
  await Promise.all([cancelled, other]);
  assert.equal(saved, true);
  assert.equal(upstream.authSeen.length, 1);
  assert.deepEqual(upstream.seen.map((r) => r.path), ['/api/auth/refresh', '/api/other']);
});

test('received refresh cookie survives malformed JWT body and is used on the next call', async (t) => {
  let attempts = 0;
  let saved = '';
  const upstream = await mockApi(t, (r, res) => {
    if (r.path === '/api/auth/refresh') {
      attempts++;
      res.setHeader('set-cookie', `refreshToken=${refresh(attempts)}`);
      if (attempts === 1) { res.end('{truncated'); return; }
      assert.equal(r.headers.cookie, `refreshToken=${refresh(1)}; token_provider=librechat`);
      return { token: access(2) };
    }
    return {};
  }, false);
  const api = new LibreChatClient(config(upstream.origin), async (token) => { saved = token; });
  await assert.rejects(api.request({ path: '/api/new' }), (e: ApiError) => e.code === 'AUTH_REFRESH_FAILED');
  assert.equal(saved, refresh(1));
  assert.equal(upstream.seen.length, 1);
  await api.request({ path: '/api/new' });
  assert.equal(saved, refresh(2));
});

test('graceful client close drains rotation and saving before completing, without starting business work', async (t) => {
  let enter!: () => void, release!: () => void, saveEnter!: () => void, saveRelease!: () => void;
  const entered = new Promise<void>((r) => { enter = r; });
  const released = new Promise<void>((r) => { release = r; });
  const saving = new Promise<void>((r) => { saveEnter = r; });
  const saved = new Promise<void>((r) => { saveRelease = r; });
  const upstream = await mockApi(t, async (_r, res) => {
    enter(); await released;
    res.setHeader('set-cookie', `refreshToken=${refresh(1)}`);
    return { token: access(1) };
  }, false);
  const api = new LibreChatClient(config(upstream.origin), async (token) => {
    assert.equal(token, refresh(1)); saveEnter(); await saved;
  });
  const request = assert.rejects(api.request({ method: 'POST', path: '/api/new' }), (e: ApiError) => e.code === 'CANCELLED');
  await entered;
  let closed = false;
  const closing = api.close().then(() => { closed = true; });
  release();
  await saving;
  assert.equal(closed, false);
  saveRelease();
  await Promise.all([closing, request]);
  assert.equal(closed, true);
  assert.equal(upstream.seen.length, 1);
});
