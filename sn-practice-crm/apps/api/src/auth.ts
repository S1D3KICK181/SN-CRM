import type { IncomingMessage } from 'node:http';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import type postgres from 'postgres';
import type { CompanyRole } from '@sn/domain';
import type { SessionActor } from '@sn/contracts';
import { ApiError } from './errors';

export interface AuthConfig {
  readonly jwksUrl?: string;
  readonly jwtSecret?: string;
  readonly jwtIssuer?: string;
  readonly allowDevActorHeader: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ASYMMETRIC_ALGORITHMS = ['RS256', 'ES256', 'EdDSA'] as const;
const SYMMETRIC_ALGORITHMS = ['HS256'] as const;

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getOrCreateRemoteJWKSet(url: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url), {
      cacheMaxAge: 600_000, // 10 minutes
      cooldownDuration: 30_000, // 30 seconds
    });
    jwksCache.set(url, jwks);
  }
  return jwks;
}

export async function verifySupabaseToken(
  token: string,
  options: { jwksUrl?: string; jwtSecret?: string; jwtIssuer?: string },
): Promise<JWTPayload & { sub: string }> {
  let alg: string | undefined;
  try {
    const header = decodeProtectedHeader(token);
    alg = header.alg;
  } catch {
    throw new ApiError(401, 'invalid_token', 'Invalid token header structure.');
  }

  if (!alg || alg === 'none') {
    throw new ApiError(401, 'invalid_token', 'Token algorithm is not permitted.');
  }

  let verifiedPayload: JWTPayload;

  try {
    if (alg === 'HS256') {
      if (!options.jwtSecret) {
        throw new ApiError(401, 'invalid_token', 'Symmetric tokens are not accepted by this configuration.');
      }
      const secret = new TextEncoder().encode(options.jwtSecret);
      const verifyOptions: { algorithms: string[]; audience: string; issuer?: string } = {
        algorithms: [...SYMMETRIC_ALGORITHMS],
        audience: 'authenticated',
      };
      if (options.jwtIssuer) {
        verifyOptions.issuer = options.jwtIssuer;
      }
      const result = await jwtVerify(token, secret, verifyOptions);
      verifiedPayload = result.payload;
    } else if (ASYMMETRIC_ALGORITHMS.includes(alg as any)) {
      if (!options.jwksUrl) {
        throw new ApiError(401, 'invalid_token', 'Asymmetric tokens are not accepted by this configuration.');
      }
      const jwks = getOrCreateRemoteJWKSet(options.jwksUrl);
      const verifyOptions: { algorithms: string[]; audience: string; issuer?: string } = {
        algorithms: [...ASYMMETRIC_ALGORITHMS],
        audience: 'authenticated',
      };
      if (options.jwtIssuer) {
        verifyOptions.issuer = options.jwtIssuer;
      }
      const result = await jwtVerify(token, jwks, verifyOptions);
      verifiedPayload = result.payload;
    } else {
      throw new ApiError(401, 'invalid_token', `Unsupported token algorithm: ${alg}`);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'invalid_token', 'Token verification failed.');
  }

  const sub = verifiedPayload.sub;
  if (!sub || !UUID_REGEX.test(sub)) {
    throw new ApiError(401, 'invalid_token', 'Token subject must be a valid RFC 4122 UUID.');
  }

  return { ...verifiedPayload, sub };
}

export const DEV_ACTOR_ALIASES: Record<string, string> = {
  usr_founder: '00000000-0000-4000-a000-000000000001',
  usr_manager: '00000000-0000-4000-a000-000000000002',
  usr_senior: '00000000-0000-4000-a000-000000000003',
  usr_staff: '00000000-0000-4000-a000-000000000004',
  usr_trainee: '00000000-0000-4000-a000-000000000005',
};

export function normalizeDevUserHeader(headerValue: string | undefined): string | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  return DEV_ACTOR_ALIASES[trimmed] ?? trimmed;
}

export async function resolveActor(
  request: IncomingMessage,
  sql: postgres.Sql,
  config: AuthConfig,
  devFallback?: (actorId: string | undefined) => Promise<SessionActor>,
): Promise<SessionActor> {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.trim().toLowerCase().startsWith('bearer ')) {
    const token = authHeader.trim().slice(7).trim();
    if (!token) {
      throw new ApiError(401, 'invalid_token', 'Bearer token is missing.');
    }
    const payload = await verifySupabaseToken(token, config);

    // Privileged pre-demotion query scoped strictly to cryptographically verified sub UUID
    const rows = await sql`
      SELECT
        p.user_id AS id,
        p.full_name AS name,
        public.role_of(p.user_id) AS role,
        srl.supervisor_id AS "reportsToId"
      FROM public.profiles p
      LEFT JOIN public.staff_reporting_lines srl ON srl.employee_id = p.user_id
      WHERE p.user_id = ${payload.sub}::uuid
        AND p.is_active = true;
    `;

    const profile = rows[0];
    if (!profile || !profile['role']) {
      throw new ApiError(403, 'forbidden', 'Employee has no active assigned role or profile.');
    }

    return {
      id: String(profile['id']),
      name: String(profile['name']),
      role: profile['role'] as CompanyRole,
      reportsToId: profile['reportsToId'] ? String(profile['reportsToId']) : null,
    };
  }

  // Fallback to dev header authentication if explicitly allowed
  if (!config.allowDevActorHeader) {
    throw new ApiError(401, 'dev_auth_disabled', 'Development header authentication is disabled.');
  }

  const rawHeader = request.headers['x-demo-user-id'];
  const actorId = normalizeDevUserHeader(typeof rawHeader === 'string' ? rawHeader : undefined);

  if (devFallback) {
    return devFallback(actorId);
  }

  if (!actorId) {
    throw new ApiError(401, 'demo_session_required', 'Choose a demo user and send its id in the x-demo-user-id header.');
  }

  throw new ApiError(401, 'demo_session_required', 'Development actor resolution fallback was not provided.');
}
