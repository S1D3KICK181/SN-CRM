import type { ApiEnvelope, ApiErrorEnvelope, SessionActor } from '@sn/contracts';
import { COMPANY_ROLES, type CompanyRole } from '@sn/domain';
import { ApiClientError, type SessionClientConfig } from './types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateAndNormalizeBaseUrl(baseUrl?: string): string {
  if (!baseUrl || baseUrl.trim() === '') {
    return '';
  }
  const trimmed = baseUrl.trim();

  // Allow relative paths (e.g. "/api")
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed.replace(/\/+$/, '');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ApiClientError({
      code: 'insecure_base_url',
      status: 0,
      message: `Invalid base URL: "${trimmed}"`,
    });
  }

  if (parsed.protocol === 'http:') {
    const host = parsed.hostname;
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    if (!isLoopback) {
      throw new ApiClientError({
        code: 'insecure_base_url',
        status: 0,
        message: 'Insecure HTTP base URL is permitted only on loopback addresses.',
      });
    }
  } else if (parsed.protocol !== 'https:') {
    throw new ApiClientError({
      code: 'insecure_base_url',
      status: 0,
      message: `Unsupported protocol in base URL: ${parsed.protocol}`,
    });
  }

  if (parsed.username || parsed.password) {
    throw new ApiClientError({
      code: 'insecure_base_url',
      status: 0,
      message: 'Base URL must not contain user credentials.',
    });
  }

  if (parsed.search || parsed.hash) {
    throw new ApiClientError({
      code: 'insecure_base_url',
      status: 0,
      message: 'Base URL must not contain query parameters or hash fragments.',
    });
  }

  return (parsed.origin + parsed.pathname).replace(/\/+$/, '');
}

export function parseSessionEnvelope(payload: unknown): SessionActor {
  if (typeof payload !== 'object' || payload === null) {
    throw new ApiClientError({
      code: 'invalid_response',
      status: 502,
      message: 'Response body is not an object',
    });
  }

  const env = payload as Record<string, unknown>;
  if (typeof env['requestId'] !== 'string' || !env['requestId'].trim()) {
    throw new ApiClientError({
      code: 'invalid_response',
      status: 502,
      message: 'Missing or empty requestId in response envelope',
    });
  }

  const data = env['data'];
  if (typeof data !== 'object' || data === null) {
    throw new ApiClientError({
      code: 'invalid_response',
      status: 502,
      message: 'Missing data in response envelope',
    });
  }

  const d = data as Record<string, unknown>;
  if (typeof d['id'] !== 'string' || !UUID_REGEX.test(d['id'])) {
    throw new ApiClientError({
      code: 'invalid_response',
      status: 502,
      message: 'SessionActor id must be a valid RFC 4122 UUID',
    });
  }

  if (typeof d['name'] !== 'string' || !d['name'].trim()) {
    throw new ApiClientError({
      code: 'invalid_response',
      status: 502,
      message: 'SessionActor name must be a non-empty string',
    });
  }

  if (typeof d['role'] !== 'string' || !COMPANY_ROLES.includes(d['role'] as CompanyRole)) {
    throw new ApiClientError({
      code: 'invalid_response',
      status: 502,
      message: `SessionActor role is invalid: ${String(d['role'])}`,
    });
  }

  if (d['reportsToId'] !== null && (typeof d['reportsToId'] !== 'string' || !UUID_REGEX.test(d['reportsToId']))) {
    throw new ApiClientError({
      code: 'invalid_response',
      status: 502,
      message: 'SessionActor reportsToId must be null or a valid RFC 4122 UUID',
    });
  }

  return {
    id: d['id'],
    name: d['name'],
    role: d['role'] as CompanyRole,
    reportsToId: (d['reportsToId'] as string | null) ?? null,
  };
}

export class SessionClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly createRequestId: () => string;

  constructor(config: SessionClientConfig = {}) {
    this.baseUrl = validateAndNormalizeBaseUrl(config.baseUrl);
    this.fetchFn = config.fetchFn ?? ((input, init) => fetch(input, init));
    this.createRequestId = config.createRequestId ?? (() => crypto.randomUUID());
  }

  public async getSession(token: string, signal?: AbortSignal): Promise<SessionActor> {
    if (!token || !token.trim()) {
      throw new ApiClientError({
        code: 'unauthenticated',
        status: 401,
        message: 'Missing access token for session request',
      });
    }

    const requestId = this.createRequestId();
    const url = `${this.baseUrl}/api/v1/session`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token.trim()}`,
          'x-request-id': requestId,
          accept: 'application/json',
        },
        credentials: 'omit',
        cache: 'no-store',
        signal,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      throw new ApiClientError({
        code: 'network_error',
        status: 0,
        message: err instanceof Error ? err.message : 'Network error communicating with CRM API',
        cause: err,
      });
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = null;
      }

      const errEnvelope = errorBody as ApiErrorEnvelope | null;
      const code = errEnvelope?.error?.code ?? (response.status === 401 ? 'invalid_token' : response.status === 403 ? 'forbidden' : 'http_error');
      const message = errEnvelope?.error?.message ?? `Session request failed with HTTP ${response.status}`;
      const details = errEnvelope?.error?.details;

      throw new ApiClientError({
        code,
        status: response.status,
        message,
        details,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      throw new ApiClientError({
        code: 'invalid_response',
        status: 502,
        message: 'Failed to parse session JSON response',
        cause: err,
      });
    }

    return parseSessionEnvelope(payload);
  }
}
