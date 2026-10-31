import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { PracticeHttpError } from "./errors.ts";

export interface SupabaseRuntimeConfig {
  url: string;
  publishableKey: string;
  serviceRoleKey?: string;
  fetch?: typeof fetch;
}

export interface AuthenticatedActor {
  userId: string;
  accessToken: string;
}

function clientOptions(authorization?: string, customFetch?: typeof fetch) {
  return {
    global: {
      ...(customFetch ? { fetch: customFetch } : {}),
      ...(authorization ? { headers: { Authorization: authorization } } : {}),
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
}

export function createUserSupabaseClient(
  config: SupabaseRuntimeConfig,
  accessToken: string,
): SupabaseClient {
  return createClient(
    config.url,
    config.publishableKey,
    clientOptions(`Bearer ${accessToken}`, config.fetch),
  );
}

export function createAdminSupabaseClient(config: SupabaseRuntimeConfig): SupabaseClient {
  if (!config.serviceRoleKey) {
    throw new PracticeHttpError(
      503,
      "OPERATIONS_NOT_CONFIGURED",
      "Operations require SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(config.url, config.serviceRoleKey, clientOptions(undefined, config.fetch));
}

export async function authenticateSupabaseActor(
  config: SupabaseRuntimeConfig,
  accessToken: string,
): Promise<{ actor: AuthenticatedActor; client: SupabaseClient }> {
  const client = createUserSupabaseClient(config, accessToken);
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new PracticeHttpError(401, "UNAUTHENTICATED", "The bearer token is invalid or expired");
  }
  return {
    actor: { userId: data.user.id, accessToken },
    client,
  };
}
