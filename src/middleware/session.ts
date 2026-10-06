import { createMiddleware } from 'hono/factory'
import type { Env } from '../env'
import { createAuth } from '../auth'
import { ApiError } from '../lib/errors'

export type SessionUser = { id: string; email: string; name: string | null }

export type AppVariables = { user: SessionUser; sessionId: string }

/**
 * Resolved bearer sessions, cached per process for a short while. Better Auth's `getSession` costs
 * two round trips to Atlas (session + user); from a laptop far from the cluster that is ~300 ms on
 * every call. A 30 s cache means a screen's burst of requests pays for it once. Sign-out evicts
 * the token (see `evictSession`); a revoked session can linger at most SESSION_CACHE_MS elsewhere.
 */
const SESSION_CACHE_MS = 30_000
const SESSION_CACHE_MAX = 5_000
type Cached = { user: SessionUser; sessionId: string; expiresAt: number }
const cache = new Map<string, Cached>()

function bearerToken(headers: Headers): string | null {
  const h = headers.get('authorization')
  return h?.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null
}

export function evictSession(token: string | null) {
  if (token) cache.delete(token)
}

export function evictSessionFrom(headers: Headers) {
  evictSession(bearerToken(headers))
}

/** Resolves the Better Auth session from the Bearer token (or cookie) and rejects with 401 if absent. */
export const requireSession = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (c, next) => {
  const token = bearerToken(c.req.raw.headers)
  const now = Date.now()
  const hit = token ? cache.get(token) : undefined
  if (hit && hit.expiresAt > now) {
    c.set('user', hit.user)
    c.set('sessionId', hit.sessionId)
    return next()
  }

  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) {
    evictSession(token)
    throw new ApiError(401, 'unauthorized', 'Sign in first')
  }
  const user: SessionUser = { id: session.user.id, email: session.user.email, name: session.user.name ?? null }
  c.set('user', user)
  c.set('sessionId', session.session.id)
  if (token) {
    if (cache.size >= SESSION_CACHE_MAX) cache.delete(cache.keys().next().value!)
    const ttl = Math.min(SESSION_CACHE_MS, new Date(session.session.expiresAt).getTime() - now)
    if (ttl > 0) cache.set(token, { user, sessionId: session.session.id, expiresAt: now + ttl })
  }
  await next()
})
