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

/** The Better Auth session behind the request's Bearer token (or cookie), or null when there is none. */
async function resolveSession(headers: Headers, env: Env): Promise<Cached | null> {
  const token = bearerToken(headers)
  const now = Date.now()
  const hit = token ? cache.get(token) : undefined
  if (hit && hit.expiresAt > now) return hit

  const auth = createAuth(env)
  const session = await auth.api.getSession({ headers })
  if (!session) {
    evictSession(token)
    return null
  }
  const user: SessionUser = { id: session.user.id, email: session.user.email, name: session.user.name ?? null }
  const resolved: Cached = { user, sessionId: session.session.id, expiresAt: 0 }
  if (token) {
    if (cache.size >= SESSION_CACHE_MAX) cache.delete(cache.keys().next().value!)
    const ttl = Math.min(SESSION_CACHE_MS, new Date(session.session.expiresAt).getTime() - now)
    if (ttl > 0) cache.set(token, { ...resolved, expiresAt: now + ttl })
  }
  return resolved
}

/** Resolves the Better Auth session from the Bearer token (or cookie) and rejects with 401 if absent. */
export const requireSession = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (c, next) => {
  const session = await resolveSession(c.req.raw.headers, c.env)
  if (!session) throw new ApiError(401, 'unauthorized', 'Sign in first')
  c.set('user', session.user)
  c.set('sessionId', session.sessionId)
  await next()
})

/** Better Auth's session cookie (default prefix; `__Secure-` over HTTPS). Other cookies do not make a viewer. */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/

export type GuestVariables = { user: SessionUser | null; sessionId: string | null }

/**
 * For routes a guest may read ("Looking around", Figma GuestTown 106:34): no credentials → `user` is null.
 * Credentials that do not resolve still answer 401, so a signed-in app whose session died learns it here too.
 */
export const optionalSession = createMiddleware<{ Bindings: Env; Variables: GuestVariables }>(async (c, next) => {
  const h = c.req.raw.headers
  if (!bearerToken(h) && !SESSION_COOKIE.test(h.get('cookie') ?? '')) {
    c.set('user', null)
    c.set('sessionId', null)
    return next()
  }
  const session = await resolveSession(c.req.raw.headers, c.env)
  if (!session) throw new ApiError(401, 'unauthorized', 'Sign in first')
  c.set('user', session.user)
  c.set('sessionId', session.sessionId)
  await next()
})
