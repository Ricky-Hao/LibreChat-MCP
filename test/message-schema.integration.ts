// Explicit A/B against the preserved, uncommitted first-design source; never imports production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { messageReadTools } from '../dist/tools/message-reads.js';

test('measure compiled current and preserved first-design reader discovery schemas', async () => {
  assert.ok(process.env.MESSAGE_READ_BASELINE_DIR, 'Provide the authorized pre-redesign source artifact directory');
  const beforeServer = new McpServer({ name: 'before', version: '1' });
  const afterServer = new McpServer({ name: 'after', version: '2' });
  const register = (server: McpServer) => (name: string, description: string, shape: z.ZodRawShape) => {
    if (!name.includes('messages_') || name === 'messages_search') return;
    server.registerTool(`librechat_${name}`, { description, inputSchema: z.strictObject(shape), annotations: { readOnlyHint: true, openWorldHint: true } }, async () => ({ content: [] }));
  };
  for (const file of ['message-reads.ts', 'conversations.ts']) {
    const source = await readFile(resolve(process.env.MESSAGE_READ_BASELINE_DIR!, file), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, Function> = {};
    runInNewContext(js, { exports, require: (name: string) => name === 'zod' ? { z } : {}, Set });
    (exports.messageReadTools ?? exports.conversationsTools)(register(beforeServer), {});
  }
  messageReadTools(register(afterServer), {} as never);
  const discovery = async (server: McpServer) => {
    const client = new Client({ name: 'schema-measurement', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a); await client.connect(b);
    try { return (await client.listTools()).tools; } finally { await client.close(); await server.close(); }
  };
  const before = await discovery(beforeServer);
  const after = await discovery(afterServer);
  assert.equal(before.length, 10); assert.equal(after.length, 3);
  if (process.env.MESSAGE_READ_SCHEMA_OUTPUT) await writeFile(process.env.MESSAGE_READ_SCHEMA_OUTPUT, JSON.stringify(after, null, 2) + '\n');
  const metrics = { firstDesignReaderTools: before.length, currentReaderTools: after.length, firstDesignSchemaUtf8Bytes: Buffer.byteLength(JSON.stringify(before)), currentSchemaUtf8Bytes: Buffer.byteLength(JSON.stringify(after)) };
  assert.ok(metrics.currentSchemaUtf8Bytes < metrics.firstDesignSchemaUtf8Bytes);
  console.log(JSON.stringify(metrics));
});
