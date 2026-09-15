import { AsyncLocalStorage } from 'node:async_hooks';
import type { Config } from './config.js';

export type Query = Record<string, string | number | boolean | (string | number | boolean)[]>;
export interface ApiRequest {
  method?: string;
  path: string;
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
}
export interface ApiResponse<T = unknown> { status: number; data: T }

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
    public data?: unknown,
    public uncertain = false,
  ) { super(message); }
}

/** Used only on output, never on data being sent back in an update. */
export function redact(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') {
    return secrets.reduce((s, secret) => secret ? s.split(secret).join('[REDACTED]') : s, value);
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [
      String(redact(key, secrets)),
      /^(authorization|cookie|set-cookie|jwt|token|tempToken|authToken|id[_-]?token|password|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|oauth_client_secret)$/i.test(key)
        ? '[REDACTED]' : redact(v, secrets),
    ]));
  }
  return value;
}

/** No route policy, retries, login or database access. Upstream decides permissions. */
export class LibreChatClient {
  private base: URL;
  private context = new AsyncLocalStorage<AbortSignal>();

  withSignal<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    return this.context.run(signal, run);
  }

  constructor(private config: Pick<Config, 'baseUrl' | 'jwt' | 'timeoutMs'>) {
    this.base = new URL(config.baseUrl.replace(/\/$/, '') + '/');
  }

  async request<T = unknown>({ method = 'GET', path, query, body, headers = {} }: ApiRequest): Promise<ApiResponse<T>> {
    const parentSignal = this.context.getStore();
    if (parentSignal?.aborted) throw new ApiError('CANCELLED', 'Call cancelled before sending this request.');
    // Relative API paths respect a baseUrl deployment prefix; absolute URLs are forwarded as-is.
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//') ? path : path.replace(/^\//, ''), this.base);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.delete(key);
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
    }
    const requestHeaders = new Headers(headers);
    // Never attach the configured LibreChat credential to another origin.
    if (url.origin === this.base.origin && !requestHeaders.has('authorization')) {
      requestHeaders.set('authorization', `Bearer ${this.config.jwt}`);
    }
    requestHeaders.set('accept', requestHeaders.get('accept') ?? 'application/json');
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart && !requestHeaders.has('content-type')) {
      requestHeaders.set('content-type', 'application/json');
    }
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
    let response: Response;
    let data: unknown;
    try {
      response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(parentSignal ? [parentSignal] : [])]),
      });
      const text = await response.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    } catch {
      throw new ApiError('NETWORK_ERROR', write
        ? 'Request interrupted or timed out. The write may have committed; read back before retrying.'
        : 'Request failed or timed out.', undefined, undefined, write);
    }
    if (!response.ok) {
      throw new ApiError(
        response.status === 409 ? 'CONFLICT' : 'UPSTREAM_ERROR',
        response.status === 401 ? 'LibreChat credential expired or invalid; replace jwt in config and restart.' : `Upstream HTTP ${response.status}`,
        response.status, data, write && response.status >= 500,
      );
    }
    return { status: response.status, data: data as T };
  }
}
