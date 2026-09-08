/**
 * The v1 error envelope and the one error type the client ever throws.
 *
 * The FastAPI adapter answers every handled failure with a *bare*
 * `{error_key, message, params}` body — not FastAPI's
 * default `{"detail": ...}` wrapper. `message` is already localized by the
 * server from `?lang=`; `error_key` is a stable English/snake_case code the
 * UI may special-case. Callers render `message` and never build their own.
 *
 * Privacy: an ApiError carries the *response* only. Request bodies (which
 * contain the RUN/IPE) are never attached to it, never stringified into
 * `message`, and never logged.
 */

/** Body shape of a handled API failure. */
export type ApiErrorEnvelope = {
  error_key: string;
  message: string;
  params: Record<string, unknown>;
};

/** Status used when the request never reached the server at all. */
export const NETWORK_ERROR_STATUS = 0;

/** `error_key` synthesized when the request never reached the server. */
export const NETWORK_ERROR_KEY = "network_error";

/** `error_key` synthesized when a response carried no usable envelope. */
export const UNEXPECTED_ERROR_KEY = "unexpected_error";

export class ApiError extends Error {
  /** HTTP status, or {@link NETWORK_ERROR_STATUS} for a transport failure. */
  readonly status: number;
  /** Stable machine-readable code; never translated, safe to switch on. */
  readonly errorKey: string;
  /** Server-localized interpolation values behind `message`. */
  readonly params: Record<string, unknown>;

  constructor(
    status: number,
    errorKey: string,
    message: string,
    params: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errorKey = errorKey;
    this.params = params;
  }

  static is(value: unknown): value is ApiError {
    return value instanceof ApiError;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asParams(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * Read an envelope out of an already-parsed response body.
 *
 * Accepts three shapes, in order of preference:
 * 1. the contract's bare `{error_key, message, params}`;
 * 2. `{detail: {error_key, message, params}}` — what FastAPI would emit if
 * the bare-envelope exception handler in `api.py` were ever bypassed;
 * 3. `{detail: "some string"}` — Starlette's own 404/405/rate-limit bodies.
 * Anything else yields `null` and the caller falls back to a generic message.
 */
export function parseErrorEnvelope(body: unknown): ApiErrorEnvelope | null {
  if (!isRecord(body)) return null;

  const direct = readEnvelope(body);
  if (direct) return direct;

  const detail = body.detail;
  const nested = readEnvelope(detail);
  if (nested) return nested;

  if (typeof detail === "string" && detail.length > 0) {
    return { error_key: UNEXPECTED_ERROR_KEY, message: detail, params: {} };
  }
  return null;
}

function readEnvelope(value: unknown): ApiErrorEnvelope | null {
  if (!isRecord(value)) return null;
  if (typeof value.error_key !== "string") return null;
  if (typeof value.message !== "string") return null;
  return {
    error_key: value.error_key,
    message: value.message,
    params: asParams(value.params),
  };
}

/**
 * Turn a failed response body into an {@link ApiError}.
 *
 * `fallbackMessage` is shown when the body is not an envelope (a proxy 502, an
 * HTML error page from a misconfigured origin, an empty body). It is supplied
 * by the caller so the presentation layer can localize it; the client passes a
 * plain English default that the UI is free to replace by matching
 * `errorKey === UNEXPECTED_ERROR_KEY`.
 */
export function toApiError(
  status: number,
  body: unknown,
  fallbackMessage: string,
): ApiError {
  const envelope = parseErrorEnvelope(body);
  if (envelope) {
    return new ApiError(
      status,
      envelope.error_key,
      envelope.message,
      envelope.params,
    );
  }
  return new ApiError(status, UNEXPECTED_ERROR_KEY, fallbackMessage);
}
