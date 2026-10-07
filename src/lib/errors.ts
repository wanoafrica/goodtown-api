import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * Error codes are part of the API contract — the apps switch on `code`, never on `message`.
 * Single source of truth: the OpenAPI `errorSchema` enum is built from this list.
 */
export const ERROR_CODES = [
  'unauthorized',
  'not_found',
  'validation',
  'under_18',
  'invalid_name',
  'invalid_date',
  'already_completed',
  'rate_limited',
  'internal',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

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
  // Thrown by Hono itself, e.g. the validator's "Malformed JSON in request body" (400).
  if (err instanceof HTTPException) {
    const code: ErrorCode = err.status === 401 ? 'unauthorized' : err.status === 404 ? 'not_found' : 'validation'
    return c.json({ ok: false, code, message: err.message }, err.status)
  }
  console.error(err)
  return c.json({ ok: false, code: 'internal', message: 'Something went wrong' }, 500)
}
