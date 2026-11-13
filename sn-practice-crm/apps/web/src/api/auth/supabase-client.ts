import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ApiClientError,
  type AuthChangeCallback,
  type AuthChangeEvent,
  type AuthSession,
  type AuthSessionSource,
} from './types';

export interface SupabaseClientConfig {
  url?: string;
  publishableKey?: string;
  auth?: {
    persistSession?: boolean;
    autoRefreshToken?: boolean;
    detectSessionInUrl?: boolean;
  };
}

export function resolveSupabaseConfig(config: SupabaseClientConfig = {}): { url: string; publishableKey: string } {
  const url = config.url ?? (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_URL : undefined);
  const publishableKey =
    config.publishableKey ??
    (typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env?.VITE_SUPABASE_ANON_KEY)
      : undefined);

  if (!url || !url.trim() || !publishableKey || !publishableKey.trim()) {
    throw new ApiClientError({
      code: 'missing_env',
      status: 0,
      message: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY configuration',
    });
  }

  return { url: url.trim(), publishableKey: publishableKey.trim() };
}

export function createSupabaseAuthClient(config: SupabaseClientConfig = {}): SupabaseClient {
  const { url, publishableKey } = resolveSupabaseConfig(config);

  return createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      ...config.auth,
    },
  });
}

export class SupabaseAuthAdapter implements AuthSessionSource {
  constructor(private readonly client: SupabaseClient) {}

  /** The signed-in Supabase client, shared so Storage calls reuse the same session and token refresh. */
  public getClient(): SupabaseClient {
    return this.client;
  }

  public async getSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error || !data.session) return null;
    return {
      accessToken: data.session.access_token,
      userId: data.session.user.id,
    };
  }

  public onAuthStateChange(callback: AuthChangeCallback): () => void {
    const {
      data: { subscription },
    } = this.client.auth.onAuthStateChange((event, session) => {
      const authSession: AuthSession | null = session
        ? {
            accessToken: session.access_token,
            userId: session.user.id,
          }
        : null;
      callback(event as AuthChangeEvent, authSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }

  public async refreshSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.refreshSession();
    if (error || !data.session) return null;
    return {
      accessToken: data.session.access_token,
      userId: data.session.user.id,
    };
  }

  public async signOut(options?: { scope?: 'local' | 'global' }): Promise<void> {
    await this.client.auth.signOut({ scope: options?.scope ?? 'local' });
  }

  public async signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<AuthSession> {
    const { data, error } = await this.client.auth.signInWithPassword(credentials);
    if (error) {
      throw error;
    }
    if (!data.session) {
      throw new Error('Sign in succeeded but no session was returned.');
    }
    return {
      accessToken: data.session.access_token,
      userId: data.session.user.id,
    };
  }
}

let defaultAdapterInstance: SupabaseAuthAdapter | null = null;

export function getSupabaseAuthAdapter(config?: SupabaseClientConfig): SupabaseAuthAdapter {
  if (config) {
    const client = createSupabaseAuthClient(config);
    return new SupabaseAuthAdapter(client);
  }
  if (!defaultAdapterInstance) {
    const client = createSupabaseAuthClient();
    defaultAdapterInstance = new SupabaseAuthAdapter(client);
  }
  return defaultAdapterInstance;
}
