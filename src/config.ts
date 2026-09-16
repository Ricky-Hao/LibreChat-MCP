import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0';

export const configSchema = z.strictObject({
  baseUrl: z.url().refine((s) => {
    const u = new URL(s);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
  }, 'baseUrl must be an HTTP(S) URL without credentials, query or fragment'),
  refreshToken: z.string().trim().min(1).refine((s) => !/\s/.test(s), 'refreshToken must be a bare token'),
  transport: z.enum(['http', 'stdio']).default('http'),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(0).max(65535).default(3000),
  authToken: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().default(30_000),
  userAgent: z.string().regex(/^[^\r\n]+$/, 'userAgent must be a non-empty single-line header').default(DEFAULT_USER_AGENT),
});
export type Config = z.infer<typeof configSchema>;

/** Save only the rotated refresh cookie; access JWTs remain in memory. */
export function refreshTokenWriter(path: string): (refreshToken: string) => Promise<void> {
  const target = resolve(path);
  return async (refreshToken) => {
    const current = JSON.parse(await readFile(target, 'utf8'));
    const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ ...current, refreshToken }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  };
}

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
