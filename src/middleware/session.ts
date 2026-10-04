import { createMiddleware } from 'hono/factory'
import type { Env } from '../env'
import { createAuth } from '../auth'
import { ApiError } from '../lib/errors'

export type SessionUser = { id: string; email: string; name: string | null }

export type AppVariables = { user: SessionUser; sessionId: string }

/** Resolves the Better Auth session from the Bearer token (or cookie) and rejects with 401 if absent. */
export const requireSession = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (c, next) => {
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) throw new ApiError(401, 'unauthorized', 'Sign in first')
  c.set('user', { id: session.user.id, email: session.user.email, name: session.user.name ?? null })
  c.set('sessionId', session.session.id)
  await next()
})
