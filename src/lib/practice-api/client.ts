import { supabase } from "@/integrations/supabase/client";
import {
  DashboardGetResponseSchema,
  PracticeErrorSchema,
  type DashboardDto,
  type DashboardGetInput,
} from "@/lib/practice-api/contract";

const DEFAULT_PRACTICE_API_URL = "http://127.0.0.1:8787";

export class PracticeApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;

  constructor(
    message: string,
    options: { code: string; status: number; requestId?: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "PracticeApiError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

function practiceApiUrl(): string {
  const configured = import.meta.env["VITE_PRACTICE_API_URL"]?.trim();
  return (configured || DEFAULT_PRACTICE_API_URL).replace(/\/+$/, "");
}

async function sessionToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw new PracticeApiError("We could not verify your session.", {
      code: "AUTH_SESSION_FAILED",
      status: 401,
      cause: error,
    });
  }

  const token = data.session?.access_token;
  if (!token) {
    throw new PracticeApiError("Your session has expired. Sign in again to continue.", {
      code: "AUTH_REQUIRED",
      status: 401,
    });
  }

  return token;
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function getPracticeDashboard(
  input: DashboardGetInput = {},
  signal?: AbortSignal,
): Promise<DashboardDto> {
  const token = await sessionToken();
  let response: Response;

  try {
    response = await fetch(`${practiceApiUrl()}/v1/query`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "dashboard.get", input }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new PracticeApiError("The practice server could not be reached.", {
      code: "NETWORK_ERROR",
      status: 0,
      cause: error,
    });
  }

  const body = await responseBody(response);

  if (!response.ok) {
    const parsedError = PracticeErrorSchema.safeParse(body);
    throw new PracticeApiError(
      parsedError.success
        ? parsedError.data.error.message
        : "The practice server rejected the request.",
      {
        code: parsedError.success ? parsedError.data.error.code : "HTTP_ERROR",
        status: response.status,
        requestId: parsedError.success ? parsedError.data.error.requestId : undefined,
      },
    );
  }

  const parsed = DashboardGetResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new PracticeApiError("The practice server returned an unexpected dashboard response.", {
      code: "INVALID_RESPONSE",
      status: response.status,
      cause: parsed.error,
    });
  }

  return parsed.data.data;
}
