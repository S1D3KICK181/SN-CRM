import { ZodError } from "zod";

export class PracticeHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "PracticeHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeError(error: unknown): PracticeHttpError {
  if (error instanceof PracticeHttpError) return error;
  if (error instanceof ZodError) {
    return new PracticeHttpError(400, "INVALID_REQUEST", "The request body is invalid", {
      issues: error.issues,
    });
  }
  if (error instanceof SyntaxError) {
    return new PracticeHttpError(400, "INVALID_JSON", "The request body is not valid JSON");
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new PracticeHttpError(499, "REQUEST_ABORTED", "The request was aborted");
  }
  return new PracticeHttpError(500, "INTERNAL_ERROR", "The server could not complete the request");
}
