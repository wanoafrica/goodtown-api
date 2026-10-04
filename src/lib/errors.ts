import type { ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Error codes are part of the API contract — the apps switch on `code`, never on `message`. */
export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'no_account'
  | 'under_18'
  | 'invalid_name'
  | 'invalid_date'
  | 'already_completed'
  | 'rate_limited'
  | 'internal'

export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: ErrorCode,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code)
  }
}

export const errorResponse: ErrorHandler = (err, c) => {
  if (err instanceof ApiError) {
    return c.json({ ok: false, code: err.code, message: err.message, details: err.details }, err.status)
  }
  console.error(err)
  return c.json({ ok: false, code: 'internal', message: 'Something went wrong' }, 500)
}
