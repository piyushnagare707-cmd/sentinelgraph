export type ErrorCode =
  | "invalid-address"
  | "not-found"
  | "rate-limited"
  | "upstream-error"
  | "timeout"
  | "internal";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  "invalid-address": 400,
  "not-found": 404,
  "rate-limited": 429,
  "upstream-error": 502,
  timeout: 504,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  if (e instanceof Error && e.name === "TimeoutError") {
    return new AppError("timeout", "Upstream request timed out");
  }
  const msg = e instanceof Error ? e.message : String(e);
  return new AppError("internal", msg);
}

export function statusFor(e: unknown): number {
  return isAppError(e) ? e.status : 500;
}
