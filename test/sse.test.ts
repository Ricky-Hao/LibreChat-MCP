import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LibreChatClient, ApiError } from '../src/client.js';
import { createHttpServer } from '../src/http.js';
import { mockApi, config, listen, jwt, refreshToken, output } from './helpers.js';

test('HTTP 200 streamed SSE error fails MCP immediately, cancels reading, redacts data and never retries', async (t) => {
  let closed!: () => void;
  const responseClosed = new Promise<void>((resolve) => { closed = resolve; });
  const upstream = await mockApi(t, async (_r, res) => {
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.once('close', closed);
    const frames = Buffer.from(': heartbeat\r\nevent: message\r\ndata: started\r\n\r\nevent: error\r\ndata: {"message":"失败 ' + jwt + '",\r\ndata: "detail":"' + refreshToken + '","code":401}\r\n\r\n');
    // Split fields, CRLF pairs and UTF-8 characters across network chunks.
    for (let i = 0; i < frames.length; i += 3) {
      res.write(frames.subarray(i, i + 3));
      await sleep(1);
    }
    // Intentionally do not end the stream: the error event must terminate the read.
  });
  const origin = await listen(t, createHttpServer({ ...config(upstream.origin), timeoutMs: 2000 }));
  const client = new Client({ name: 'sse-error-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
  const logs: string[] = [];
  const stderr = t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; });
  const result = await client.callTool({ name: 'librechat_api_request', arguments: { method: 'POST', path: '/api/stream', body: {} } });
  stderr.mock.restore();
  assert.equal(result.isError, true);
  assert.deepEqual(output(result).error, {
    code: 'UPSTREAM_STREAM_ERROR',
    message: 'Upstream emitted an SSE error event. Inspect resource state before retrying a write.',
    status: 200, data: { message: '失败 [REDACTED]', detail: '[REDACTED]', code: 401 }, uncertain: true,
  });
  await responseClosed;
  assert.equal(upstream.seen.length, 1);
  assert.equal(upstream.authSeen.length, 1); // SSE payload code=401 is not an HTTP auth rejection.
  for (const secret of [jwt, refreshToken]) assert.equal(JSON.stringify({ result, logs }).includes(secret), false);
});

test('SSE text, empty-data and unterminated final error events retain their payload', async (t) => {
  for (const [frame, data, omitType] of [
    ['event: error\ndata: unavailable\n\n', 'unavailable', false],
    ['event:error\ndata:\n\n', null, false],
    ['event: error\ndata: {"message":"last frame"}', { message: 'last frame' }, false],
    ['event: message\ndata: started\n\nevent: error\ndata: denied\n\n', 'denied', true],
  ] as const) {
    const upstream = await mockApi(t, (_r, res) => {
      if (omitType) res.removeHeader('content-type');
      else res.setHeader('content-type', 'text/event-stream');
      res.end(frame);
    });
    await assert.rejects(new LibreChatClient(config(upstream.origin)).request({ path: '/api/stream' }), (e: ApiError) => {
      assert.equal(e.code, 'UPSTREAM_STREAM_ERROR');
      assert.equal(e.status, 200);
      assert.equal(e.uncertain, false);
      assert.deepEqual(e.data, data);
      return true;
    });
  }
});

test('normal SSE, comments/data containing event:error and non-SSE text remain successful', async (t) => {
  const body = ': event: error\nevent: message\ndata: event: error\n\nevent: done\ndata: [DONE]\n\n';
  for (const [contentType, text] of [
    ['text/event-stream', body],
    ['text/plain', 'event: error\ndata: example text\n\n'],
  ]) {
    const upstream = await mockApi(t, (_r, res) => { res.setHeader('content-type', contentType); res.end(text); });
    assert.deepEqual(await new LibreChatClient(config(upstream.origin)).request({ path: '/api/stream' }), { status: 200, data: text });
  }
});
