import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiError, LibreChatClient } from './client.js';
import type { Config } from './config.js';
import type { Register } from './tools/common.js';
import { skillsTools } from './tools/skills.js';
import { agentsTools } from './tools/agents.js';
import { schedulesTools } from './tools/schedules.js';
import { promptsTools } from './tools/prompts.js';
import { permissionsTools } from './tools/permissions.js';
import { conversationsTools } from './tools/conversations.js';
import { projectsTools } from './tools/projects.js';

/** Config objects carry no file path: the default client is in-memory; CLI injects a writer. */
export function createMcpServer(config: Config, api = new LibreChatClient(config)) {
  const server = new McpServer({ name: 'librechat-mcp', version: '0.3.0' });
  const register: Register = (name, description, shape, run, readOnly = false) => {
    const inputSchema = z.strictObject(shape);
    server.registerTool<z.ZodRawShape, typeof inputSchema>(`librechat_${name}`, {
      description, inputSchema,
      annotations: { readOnlyHint: readOnly, openWorldHint: true },
    }, async (input, extra) => {
      const started = Date.now();
      let output: unknown;
      let isError = false;
      try {
        output = await api.withSignal(extra.signal, () => run(input as Parameters<typeof run>[0]));
      } catch (error) {
        isError = true;
        output = error instanceof ApiError ? {
          error: { code: error.code, message: error.message, status: error.status, data: error.data, uncertain: error.uncertain },
        } : { error: { code: 'INTERNAL_ERROR', message: 'Operation failed. Check configuration and input; inspect resource state before retrying a write.' } };
      }
      // Metadata only. Never log configuration, input, URLs, body or exception objects.
      process.stderr.write(JSON.stringify({ tool: `librechat_${name}`, durationMs: Date.now() - started, outcome: isError ? 'error' : 'ok' }) + '\n');
      const safe = api.redact(output, [config.authToken ?? '']);
      return { content: [{ type: 'text' as const, text: JSON.stringify(safe) }], isError };
    });
  };
  for (const tools of [skillsTools, agentsTools, schedulesTools, promptsTools, permissionsTools, conversationsTools, projectsTools]) tools(register, api);
  const scalar = z.union([z.string(), z.number(), z.boolean()]);
  register('api_request', 'Forward an API request without endpoint allowlists or write restrictions. Relative paths use baseUrl. Absolute URLs are allowed; managed JWT is attached only to the baseUrl origin. Returns JSON/text and HTTP status; redirects are returned, not followed. This can modify, delete, share or execute anything the upstream user may access.', {
    method: z.string().default('GET'), path: z.string().optional(), url: z.string().optional(),
    query: z.record(z.string(), z.union([scalar, z.array(scalar)])).optional(),
    body: z.unknown().optional(), headers: z.record(z.string(), z.string()).optional(),
  }, ({ path, url, ...request }) => {
    if ((!path && !url) || (path && url)) throw new ApiError('INVALID_INPUT', 'Provide exactly one of path or url.');
    return api.request({ ...request, path: (path ?? url)! });
  });
  return server;
}
