import { PracticeHttpError } from "./errors.ts";
import type { SupabaseRuntimeConfig } from "./supabase.ts";
import { IsoDateSchema } from "../src/lib/practice-api/contract.ts";

export type PracticeApiMode = "demo" | "supabase";

export interface PracticeServerConfig {
  mode: PracticeApiMode;
  host: string;
  port: number;
  bodyLimitBytes: number;
  allowedOrigins: ReadonlySet<string>;
  demoAsOfDate: string;
  shutdownTimeoutMs: number;
  supabase?: SupabaseRuntimeConfig;
}

const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:8080",
  "http://localhost:8080",
];

function positiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new PracticeHttpError(500, "INVALID_CONFIGURATION", name + " must be a positive integer");
  }
  return parsed;
}

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new PracticeHttpError(500, "INVALID_CONFIGURATION", name + " is required");
  }
  return value.trim();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PracticeServerConfig {
  const rawMode = (env["PRACTICE_API_MODE"] || "demo").trim().toLowerCase();
  if (rawMode !== "demo" && rawMode !== "supabase") {
    throw new PracticeHttpError(
      500,
      "INVALID_CONFIGURATION",
      "PRACTICE_API_MODE must be demo or supabase",
    );
  }

  const configuredOrigins = env["PRACTICE_API_ALLOWED_ORIGINS"]
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set(
    configuredOrigins?.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS,
  );
  if ([...allowedOrigins].some((origin) => origin === "*")) {
    throw new PracticeHttpError(
      500,
      "INVALID_CONFIGURATION",
      "Wildcard CORS origins are not allowed",
    );
  }
  for (const origin of allowedOrigins) {
    try {
      const url = new URL(origin);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin) {
        throw new Error("not an HTTP origin");
      }
    } catch {
      throw new PracticeHttpError(
        500,
        "INVALID_CONFIGURATION",
        "PRACTICE_API_ALLOWED_ORIGINS must contain exact HTTP(S) origins",
      );
    }
  }

  const demoAsOfDate = env["PRACTICE_API_DEMO_AS_OF_DATE"]?.trim() || "2026-10-30";
  if (!IsoDateSchema.safeParse(demoAsOfDate).success) {
    throw new PracticeHttpError(
      500,
      "INVALID_CONFIGURATION",
      "PRACTICE_API_DEMO_AS_OF_DATE must be a valid YYYY-MM-DD date",
    );
  }

  const base: PracticeServerConfig = {
    mode: rawMode,
    host: env["PRACTICE_API_HOST"]?.trim() || "127.0.0.1",
    port: positiveInteger("PRACTICE_API_PORT", env["PRACTICE_API_PORT"], 8787, 65_535),
    bodyLimitBytes: positiveInteger(
      "PRACTICE_API_BODY_LIMIT_BYTES",
      env["PRACTICE_API_BODY_LIMIT_BYTES"],
      1_048_576,
    ),
    allowedOrigins,
    demoAsOfDate,
    shutdownTimeoutMs: positiveInteger(
      "PRACTICE_API_SHUTDOWN_TIMEOUT_MS",
      env["PRACTICE_API_SHUTDOWN_TIMEOUT_MS"],
      10_000,
    ),
  };

  if (rawMode === "supabase") {
    const serviceRoleKey = env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
    base.supabase = {
      url: required("SUPABASE_URL", env["SUPABASE_URL"] || env["VITE_SUPABASE_URL"]),
      publishableKey: required(
        "SUPABASE_PUBLISHABLE_KEY",
        env["SUPABASE_PUBLISHABLE_KEY"] || env["VITE_SUPABASE_PUBLISHABLE_KEY"],
      ),
      ...(serviceRoleKey ? { serviceRoleKey } : {}),
    };
  }

  return base;
}
