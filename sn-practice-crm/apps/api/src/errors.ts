export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function notFound(resource: string): ApiError {
  return new ApiError(404, 'not_found', `${resource} was not found.`);
}

export function forbidden(code: string, message: string): ApiError {
  return new ApiError(403, code, message);
}
