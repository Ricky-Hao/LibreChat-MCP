import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { configSchema } from '../src/config.js';

export const jwt = 'test-only-upstream-credential';
export const refreshToken = 'test-only-refresh-cookie';
export const skillId = '0123456789abcdef01234567';
export const groupId = '1123456789abcdef01234567';
export const promptId = '2123456789abcdef01234567';
export const config = (baseUrl: string) => configSchema.parse({ baseUrl, refreshToken });
export interface Seen { method: string; path: string; body: any; headers: IncomingMessage['headers'] }

export async function listen(t: TestContext, server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export async function mockApi(t: TestContext, reply: (r: Seen, res: ServerResponse) => unknown, autoRefresh = true) {
  const seen: Seen[] = [];
  const authSeen: Seen[] = [];
  const origin = await listen(t, createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* text or multipart */ }
    const request = { method: req.method!, path: req.url!, body, headers: req.headers };
    res.setHeader('content-type', 'application/json');
    if (request.path.endsWith('/api/auth/refresh')) {
      authSeen.push(request);
      if (autoRefresh) {
        res.setHeader('set-cookie', `refreshToken=${refreshToken}; HttpOnly`);
        res.end(JSON.stringify({ token: jwt })); return;
      }
    }
    seen.push(request);
    const data = await reply(request, res);
    if (data !== undefined) res.end(JSON.stringify(data));
  }));
  return { origin, seen, authSeen };
}

export function output(result: any): any {
  return JSON.parse(result.content[0].text);
}
