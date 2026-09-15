#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, refreshTokenWriter } from './config.js';
import { LibreChatClient } from './client.js';
import { createMcpServer } from './server.js';
import { createHttpServer } from './http.js';

function onShutdown(api: LibreChatClient, stop: () => void | Promise<void>) {
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    try {
      await Promise.all([api.close(), stop()]);
      process.exit(0);
    } catch {
      console.error('Shutdown refresh/save failed. Check writable configuration or obtain a new refreshToken.');
      process.exit(1);
    }
  });
}

async function main() {
  const { values } = parseArgs({ options: {
    config: { type: 'string', default: 'config.json' },
    transport: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('librechat-mcp --config <config.json> [--transport http|stdio]');
    return;
  }
  const config = await loadConfig(values.config!);
  if (values.transport) {
    if (!['http', 'stdio'].includes(values.transport)) throw new Error('transport must be http or stdio');
    config.transport = values.transport as 'http' | 'stdio';
  }
  const api = new LibreChatClient(config, refreshTokenWriter(values.config!));
  if (config.transport === 'stdio') {
    const server = createMcpServer(config, api);
    await server.connect(new StdioServerTransport());
    onShutdown(api, () => server.close());
    return;
  }
  const server = createHttpServer(config, api);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  console.error(`librechat-mcp listening on port ${(server.address() as { port: number }).port}; ${config.authToken ? 'bearer authentication enabled' : 'NO authentication — trusted network only'}`);
  onShutdown(api, () => { server.close(); server.closeAllConnections(); });
}

main().catch(() => {
  // Config/CLI errors must not echo a accidentally supplied credential or file content.
  console.error('Unable to start librechat-mcp. Check --config, JSON fields, transport and listen address. See README.');
  process.exitCode = 1;
});
