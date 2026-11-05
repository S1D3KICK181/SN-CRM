import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as supabaseModule from '@supabase/supabase-js';
import { ApiClientError } from './types';
import {
  createSupabaseAuthClient,
  resolveSupabaseConfig,
  SupabaseAuthAdapter,
} from './supabase-client';

describe('Supabase Client Factory & Auth Adapter', () => {
  it('TC-SB-01: resolveSupabaseConfig throws ApiClientError({ code: "missing_env" }) when URL is missing', () => {
    expect(() => resolveSupabaseConfig({ url: '', publishableKey: 'key-123' })).toThrowError(ApiClientError);
    try {
      resolveSupabaseConfig({ url: '', publishableKey: 'key-123' });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      const apiErr = err as ApiClientError;
      expect(apiErr.code).toBe('missing_env');
    }
  });

  it('TC-SB-02: resolveSupabaseConfig throws ApiClientError({ code: "missing_env" }) when publishable key is missing', () => {
    expect(() => resolveSupabaseConfig({ url: 'http://127.0.0.1:54321', publishableKey: '' })).toThrowError(ApiClientError);
    try {
      resolveSupabaseConfig({ url: 'http://127.0.0.1:54321', publishableKey: '   ' });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      const apiErr = err as ApiClientError;
      expect(apiErr.code).toBe('missing_env');
    }
  });

  it('TC-SB-03: resolveSupabaseConfig falls back to VITE_SUPABASE_ANON_KEY when VITE_SUPABASE_PUBLISHABLE_KEY is not provided', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-fallback');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    try {
      const config = resolveSupabaseConfig();
      expect(config).toEqual({
        url: 'http://127.0.0.1:54321',
        publishableKey: 'anon-key-fallback',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('TC-SB-04: createSupabaseAuthClient passes persistSession: true, autoRefreshToken: true, detectSessionInUrl: false', () => {
    const client = createSupabaseAuthClient({
      url: 'http://127.0.0.1:54321',
      publishableKey: 'test-key',
    });
    expect((client.auth as any).persistSession).toBe(true);
    expect((client.auth as any).autoRefreshToken).toBe(true);
    expect((client.auth as any).detectSessionInUrl).toBe(false);
  });

  it('TC-SB-05: SupabaseAuthAdapter.getSession() maps { access_token, user: { id } } to AuthSession', async () => {
    const mockClient = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: 'mock-access-token',
              user: { id: '00000000-0000-4000-a000-000000000001' },
            },
          },
          error: null,
        }),
      },
    } as unknown as SupabaseClient;

    const adapter = new SupabaseAuthAdapter(mockClient);
    const session = await adapter.getSession();
    expect(session).toEqual({
      accessToken: 'mock-access-token',
      userId: '00000000-0000-4000-a000-000000000001',
    });
  });

  it('TC-SB-06: SupabaseAuthAdapter.onAuthStateChange() maps event and session, returning unsubscribe cleanup', () => {
    const unsubscribeMock = vi.fn();
    let authListener: ((event: string, session: any) => void) | null = null;

    const mockClient = {
      auth: {
        onAuthStateChange: vi.fn().mockImplementation((cb) => {
          authListener = cb;
          return { data: { subscription: { unsubscribe: unsubscribeMock } } };
        }),
      },
    } as unknown as SupabaseClient;

    const adapter = new SupabaseAuthAdapter(mockClient);
    const receivedEvents: Array<{ event: string; session: any }> = [];
    const unsubscribe = adapter.onAuthStateChange((event, session) => {
      receivedEvents.push({ event, session });
    });

    expect(authListener).not.toBeNull();
    authListener!('SIGNED_IN', {
      access_token: 'token-abc',
      user: { id: 'user-123' },
    });

    expect(receivedEvents).toEqual([
      {
        event: 'SIGNED_IN',
        session: { accessToken: 'token-abc', userId: 'user-123' },
      },
    ]);

    unsubscribe();
    expect(unsubscribeMock).toHaveBeenCalledOnce();
  });

  it('TC-SB-07: SupabaseAuthAdapter.signOut() forwards { scope: "local" } by default', async () => {
    const signOutMock = vi.fn().mockResolvedValue({ error: null });
    const mockClient = {
      auth: {
        signOut: signOutMock,
      },
    } as unknown as SupabaseClient;

    const adapter = new SupabaseAuthAdapter(mockClient);
    await adapter.signOut();
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });

    await adapter.signOut({ scope: 'global' });
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('TC-SB-08: SupabaseAuthAdapter.signInWithPassword() returns AuthSession on success and throws GoTrue error on failure', async () => {
    const signInMock = vi.fn();
    const mockClient = {
      auth: {
        signInWithPassword: signInMock,
      },
    } as unknown as SupabaseClient;

    const adapter = new SupabaseAuthAdapter(mockClient);

    // Success
    signInMock.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'pwd-token',
          user: { id: '00000000-0000-4000-a000-000000000002' },
        },
      },
      error: null,
    });
    const session = await adapter.signInWithPassword({
      email: 'test@sn-demo.local',
      password: 'password123',
    });
    expect(session).toEqual({
      accessToken: 'pwd-token',
      userId: '00000000-0000-4000-a000-000000000002',
    });

    // Failure
    const gotrueError = new Error('Invalid login credentials');
    signInMock.mockResolvedValueOnce({
      data: { session: null },
      error: gotrueError,
    });
    await expect(
      adapter.signInWithPassword({
        email: 'bad@sn-demo.local',
        password: 'wrong',
      }),
    ).rejects.toThrow('Invalid login credentials');
  });
});
