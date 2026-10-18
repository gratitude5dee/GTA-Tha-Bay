import { HTTP_FOR, type ApiError, type ApiErrorCode } from '@dv/shared';

export interface ErrorOptions {
  retryAfterMs?: number;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Overrides HTTP_FOR[code]; C12 has no 405 code, so 405 reuses `bad_request`. */
  status?: number;
}

/** Builds the C12 error envelope. `requestId` is the same value as the X-Request-Id response header. */
export function apiError(code: ApiErrorCode, message: string, requestId: string, options: ErrorOptions = {}): Response {
  const body: ApiError = {
    error: {
      code,
      message,
      requestId,
      ...(options.retryAfterMs !== undefined ? { retryAfterMs: options.retryAfterMs } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    },
  };
  return new Response(JSON.stringify(body), {
    status: options.status ?? HTTP_FOR[code],
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...options.headers },
  });
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...init.headers },
  });
}
