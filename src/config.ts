import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const configSchema = z.strictObject({
  baseUrl: z.url().refine((s) => {
    const u = new URL(s);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
  }, 'baseUrl must be an HTTP(S) URL without credentials, query or fragment'),
  jwt: z.string().trim().min(1).refine((s) => !/\s/.test(s), 'jwt must be a bare token'),
  transport: z.enum(['http', 'stdio']).default('http'),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(0).max(65535).default(3000),
  authToken: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().default(30_000),
});
export type Config = z.infer<typeof configSchema>;

export async function loadConfig(path: string): Promise<Config> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('Cannot read configuration JSON. Use --config <file>.');
  }
  const result = configSchema.safeParse(data);
  if (!result.success) {
    // Never print input values: this file contains credentials.
    throw new Error(`Invalid configuration fields: ${result.error.issues.map((i) => i.path.join('.') || '(root)').join(', ')}`);
  }
  return result.data;
}
