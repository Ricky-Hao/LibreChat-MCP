#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createMcpServer } from './server.js';
import { createHttpServer } from './http.js';

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
  if (config.transport === 'stdio') {
    const server = createMcpServer(config);
    await server.connect(new StdioServerTransport());
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void server.close().then(() => process.exit(0)); });
    return;
  }
  const server = createHttpServer(config);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  console.error(`librechat-mcp listening on port ${(server.address() as { port: number }).port}; ${config.authToken ? 'bearer authentication enabled' : 'NO authentication — trusted network only'}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5000).unref();
  });
}

main().catch(() => {
  // Config/CLI errors must not echo a accidentally supplied credential or file content.
  console.error('Unable to start librechat-mcp. Check --config, JSON fields, transport and listen address. See README.');
  process.exitCode = 1;
});
