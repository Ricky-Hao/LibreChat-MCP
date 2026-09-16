import { AsyncLocalStorage } from 'node:async_hooks';
import { createParser } from 'eventsource-parser';
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

function parseText(text: string): unknown {
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

/** SSE can fail at the application layer after successful HTTP headers. */
async function readBody(response: Response, write: boolean): Promise<string> {
  const mediaType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  // LibreChat denyRequest can emit SSE without setting Content-Type.
  if (!response.ok || (mediaType && mediaType !== 'text/event-stream') || !response.body) {
    return response.text();
  }
  const parser = createParser({ onEvent(event) {
    if (event.event === 'error') {
      throw new ApiError('UPSTREAM_STREAM_ERROR', 'Upstream emitted an SSE error event. Inspect resource state before retrying a write.', response.status, parseText(event.data), write);
    }
  } });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
      chunks.push(text);
      parser.feed(text);
      if (done) {
        parser.feed('\n\n'); // Also inspect a final frame from servers omitting its blank terminator.
        return chunks.join('');
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
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

/** One instance per process. Without saveRefreshToken, state is explicitly in-memory only. */
export class LibreChatClient {
  private base: URL;
  private jwt?: string;
  private refreshToken: string;
  private secrets = new Set<string>();
  private generation = 0;
  private unsaved = false;
  private closed = false;
  private refreshFlight?: Promise<void>;
  private context = new AsyncLocalStorage<AbortSignal>();

  constructor(
    private config: Pick<Config, 'baseUrl' | 'refreshToken' | 'timeoutMs' | 'userAgent'>,
    private saveRefreshToken?: (refreshToken: string) => Promise<void>,
  ) {
    this.base = new URL(config.baseUrl.replace(/\/$/, '') + '/');
    this.refreshToken = config.refreshToken;
    this.secrets.add(config.refreshToken);
  }

  redact(value: unknown, extraSecrets: string[] = []): unknown {
    return redact(value, [...this.secrets, ...extraSecrets]);
  }

  withSignal<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    return this.context.run(signal, run);
  }

  /** Stop new requests, but finish any refresh/save before a graceful process shutdown. */
  async close(): Promise<void> {
    this.closed = true;
    try { await this.refreshFlight; }
    finally { if (this.unsaved) await this.persist(); }
  }

  private async persist() {
    try {
      await this.saveRefreshToken!(this.refreshToken);
      this.unsaved = false;
    } catch {
      throw new ApiError('AUTH_PERSIST_FAILED', 'Rotated refreshToken is in memory but could not be saved. Make the config directory writable and call again before restarting. Mount the directory, not a read-only or individual config file.');
    }
  }

  private refresh(expectedGeneration: number): Promise<void> {
    if (this.refreshFlight) return this.refreshFlight;
    if (this.closed) return Promise.reject(new ApiError('CANCELLED', 'Client is shutting down.'));
    // A delayed 401 may belong to the old JWT even after another call has refreshed it.
    if (expectedGeneration !== this.generation && this.jwt && !this.unsaved) return Promise.resolve();
    this.refreshFlight = (async () => {
      if (this.unsaved) {
        await this.persist();
        if (this.jwt) return;
      }
      await this.issueCredentials();
    })().finally(() => { this.refreshFlight = undefined; });
    return this.refreshFlight;
  }

  private async issueCredentials(): Promise<void> {
    let status: number | undefined;
    try {
      // Deliberately independent of an individual MCP call's cancellation: a refresh rotates
      // the server session and must be saved even if one waiter disconnects. No refresh retry.
      const response = await fetch(new URL('api/auth/refresh', this.base), {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: { accept: 'application/json', 'user-agent': this.config.userAgent, cookie: `refreshToken=${encodeURIComponent(this.refreshToken)}; token_provider=librechat` },
      });
      status = response.status;
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      // Headers can arrive even when the JWT body is later interrupted. Preserve a received
      // rotation regardless of body parsing, since upstream already replaced its session hash.
      const cookie = response.headers.getSetCookie().find((s) => s.startsWith('refreshToken='));
      if (!cookie) throw new Error(); // LibreChat rotates and returns this cookie on every successful refresh.
      const token = decodeURIComponent(cookie.split(';')[0].slice('refreshToken='.length));
      if (!token || /\s/.test(token)) throw new Error();
      this.refreshToken = token;
      this.secrets.add(token);
      this.unsaved = !!this.saveRefreshToken;
      const data = await response.json() as { token?: unknown };
      if (typeof data.token !== 'string' || !data.token || /\s/.test(data.token)) throw new Error();
      this.jwt = data.token;
      this.secrets.add(data.token);
      this.generation++;
    } catch {
      this.jwt = undefined;
      // The response can contain secrets; never forward it or the underlying exception.
      throw new ApiError('AUTH_REFRESH_FAILED', 'LibreChat refresh failed or returned incomplete credentials. Check refreshToken validity and Set-Cookie forwarding; sign in again if expired or revoked. No business request was replayed.', status);
    } finally {
      if (this.unsaved) await this.persist();
    }
  }

  async request<T = unknown>({ method = 'GET', path, query, body, headers = {} }: ApiRequest): Promise<ApiResponse<T>> {
    const parentSignal = this.context.getStore();
    const checkCancelled = () => {
      if (this.closed || parentSignal?.aborted) throw new ApiError('CANCELLED', 'Call cancelled before sending this request.');
    };
    checkCancelled();
    // Relative API paths respect a deployment prefix; absolute URLs are forwarded as-is.
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//') ? path : path.replace(/^\//, ''), this.base);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.delete(key);
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
    }
    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has('user-agent')) requestHeaders.set('user-agent', this.config.userAgent);
    const managedAuth = url.origin === this.base.origin && !requestHeaders.has('authorization') && !requestHeaders.has('cookie');
    const canRefresh = managedAuth && url.pathname.replace(/\/$/, '') !== new URL('api/auth/refresh', this.base).pathname;
    if (canRefresh && (!this.jwt || this.unsaved)) await this.refresh(this.generation);
    requestHeaders.set('accept', requestHeaders.get('accept') ?? 'application/json');
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart && !requestHeaders.has('content-type')) requestHeaders.set('content-type', 'application/json');
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
    const send = async () => {
      checkCancelled();
      const generation = this.generation;
      if (managedAuth && this.jwt) requestHeaders.set('authorization', `Bearer ${this.jwt}`);
      try {
        const response = await fetch(url, {
          method, headers: requestHeaders,
          body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
          redirect: 'manual',
          signal: AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(parentSignal ? [parentSignal] : [])]),
        });
        const data = parseText(await readBody(response, write));
        return { response, data, generation };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError('NETWORK_ERROR', write
          ? 'Request interrupted or timed out. The write may have committed; read back before retrying.'
          : 'Request failed or timed out.', undefined, undefined, write);
      }
    };
    let result = await send();
    if (result.response.status === 401 && canRefresh) {
      await this.refresh(result.generation);
      result = await send(); // One replay only after an explicit auth rejection, never a network/5xx retry.
    }
    const { response, data } = result;
    if (!response.ok) {
      throw new ApiError(
        response.status === 409 ? 'CONFLICT' : 'UPSTREAM_ERROR',
        response.status === 401 && canRefresh ? 'LibreChat JWT was rejected after refresh; check the user/session and replace refreshToken from a new login if needed.' : `Upstream HTTP ${response.status}`,
        response.status, data, write && response.status >= 500,
      );
    }
    return { status: response.status, data: data as T };
  }
}
