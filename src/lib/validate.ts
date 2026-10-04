import type { Context } from 'hono'
import { ApiError } from './errors'

/**
 * Hook for `validator()` from hono-openapi: turns a failed validation into the
 * standard `{ ok:false, code:'validation' }` error envelope (400) instead of
 * the library's default body, so the apps see one error shape everywhere.
 */
export function validationHook(result: { success: boolean; error?: unknown }, _c: Context): void {
  if (!result.success) {
    throw new ApiError(400, 'validation', 'Invalid request', result.error)
  }
}
