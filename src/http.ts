import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';
import { LibreChatClient } from './client.js';
import type { Config } from './config.js';

/** Stateless HTTP. Pass a client with refreshTokenWriter for persistence (the CLI does this).
 * HTTP disconnect cancels that call; cancellation notifications on separate POSTs are not routed.
 */
export function createHttpServer(config: Config, api = new LibreChatClient(config)) {
  return createServer(async (req, res) => {
    const path = req.url?.split('?')[0];
    res.setHeader('Content-Type', 'application/json');
    if (path === '/healthz' && req.method === 'GET') {
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (path !== '/mcp') { res.writeHead(404).end(); return; }
    if (config.authToken && req.headers.authorization !== `Bearer ${config.authToken}`) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } }));
      return;
    }
    const server = createMcpServer(config, api);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }));
      } else { res.end(); }
    }
  });
}
