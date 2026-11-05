import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { resolveActor, verifySupabaseToken } from './auth';

const VALID_USER_ID = '00000000-0000-4000-a000-000000000001';
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-chars';

describe('auth: verifySupabaseToken', () => {
  it('verifies valid HS256 symmetric tokens', async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new SignJWT({ aud: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(VALID_USER_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    const payload = await verifySupabaseToken(token, { jwtSecret: JWT_SECRET });
    expect(payload.sub).toBe(VALID_USER_ID);
  });

  it('rejects expired HS256 tokens', async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new SignJWT({ aud: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(VALID_USER_ID)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secret);

    await expect(verifySupabaseToken(token, { jwtSecret: JWT_SECRET })).rejects.toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
  });

  it('rejects tokens with invalid audience', async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new SignJWT({ aud: 'wrong_audience' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(VALID_USER_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await expect(verifySupabaseToken(token, { jwtSecret: JWT_SECRET })).rejects.toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
  });

  it('rejects tokens with non-UUID sub', async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new SignJWT({ aud: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('not-a-valid-uuid')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await expect(verifySupabaseToken(token, { jwtSecret: JWT_SECRET })).rejects.toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
  });

  it('rejects tokens with unapproved or none algorithm', async () => {
    // Malicious token with alg: 'none' (represented as unsigned payload structure)
    const noneToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtYTAwMC0wMDAwMDAwMDAwMDEiLCJhdWQiOiJhdXRoZW50aWNhdGVkIn0.';
    await expect(verifySupabaseToken(noneToken, { jwtSecret: JWT_SECRET })).rejects.toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
  });

  it('rejects HS256 tokens when only JWKS path is configured (cross-algorithm confusion protection)', async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new SignJWT({ aud: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(VALID_USER_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await expect(
      verifySupabaseToken(token, { jwksUrl: 'https://example.supabase.co/auth/v1/.well-known/jwks.json' }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
  });
});

describe('auth: resolveActor', () => {
  it('resolves SessionActor from valid Bearer token via privileged pre-demotion DB lookup', async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new SignJWT({ aud: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(VALID_USER_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    const mockSql = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        return Promise.resolve([
          {
            id: VALID_USER_ID,
            name: 'S. Narayanan',
            role: 'founder',
            reportsToId: null,
          },
        ]);
      },
      {},
    );

    const request = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    } as any;

    const actor = await resolveActor(request, mockSql as any, {
      jwtSecret: JWT_SECRET,
      allowDevActorHeader: false,
    });

    expect(actor).toEqual({
      id: VALID_USER_ID,
      name: 'S. Narayanan',
      role: 'founder',
      reportsToId: null,
    });
  });

  it('verifies valid RS256 asymmetric token via in-memory JWKS and yields full SessionActor', async () => {
    const keyPair = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    publicJwk.kid = 'test-rsa-key-1';

    const testJwksUrl = 'https://in-memory-auth.local/auth/v1/.well-known/jwks.json';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url === testJwksUrl) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch call to ${url}`);
    });

    try {
      const token = await new SignJWT({ aud: 'authenticated' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-rsa-key-1' })
        .setSubject(VALID_USER_ID)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keyPair.privateKey);

      // Verify token verifies via verifySupabaseToken
      const payload = await verifySupabaseToken(token, { jwksUrl: testJwksUrl });
      expect(payload.sub).toBe(VALID_USER_ID);

      // Verify token verifies and yields full SessionActor via resolveActor
      const mockSql = Object.assign(
        (strings: TemplateStringsArray, ...values: unknown[]) => {
          return Promise.resolve([
            {
              id: VALID_USER_ID,
              name: 'S. Narayanan',
              role: 'founder',
              reportsToId: null,
            },
          ]);
        },
        {},
      );

      const request = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      } as any;

      const actor = await resolveActor(request, mockSql as any, {
        jwksUrl: testJwksUrl,
        allowDevActorHeader: false,
      });

      expect(actor).toEqual({
        id: VALID_USER_ID,
        name: 'S. Narayanan',
        role: 'founder',
        reportsToId: null,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('throws 403 forbidden if employee profile is inactive or missing in database', async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new SignJWT({ aud: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(VALID_USER_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    const mockSql = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        return Promise.resolve([]); // Profile not found or inactive
      },
      {},
    );

    const request = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    } as any;

    await expect(
      resolveActor(request, mockSql as any, {
        jwtSecret: JWT_SECRET,
        allowDevActorHeader: false,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('rejects x-demo-user-id header when allowDevActorHeader is false', async () => {
    const request = {
      headers: {
        'x-demo-user-id': VALID_USER_ID,
      },
    } as any;

    await expect(
      resolveActor(request, {} as any, {
        jwtSecret: JWT_SECRET,
        allowDevActorHeader: false,
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'dev_auth_disabled',
    });
  });
});
