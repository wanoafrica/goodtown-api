import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import type { Env } from './env'
import { BETTER_AUTH_PATHS, createAuth } from './auth'
import { getDb } from './db/client'
import { errorResponse } from './lib/errors'
import { authRoutes } from './routes/auth'
import { signupRoutes } from './routes/signup'
import { townRoutes } from './routes/towns'
import { meRoutes } from './routes/me'
import { feedRoutes } from './routes/feed'
import { mountDocs } from './openapi/docs'
import { evictSessionFrom } from './middleware/session'

const app = new Hono<{ Bindings: Env }>()

// Log method, path, status and timing, never the query string: it carries the user's coordinates
// (/v1/towns/resolve?lat=…&lng=…) and search terms.
app.use(
  '*',
  logger((line, ...rest) => console.log(line.replace(/\?\S*/, ''), ...rest)),
)
app.use('*', secureHeaders())
app.onError(errorResponse)
app.notFound((c) => c.json({ ok: false, code: 'not_found' }, 404))

app.get('/', (c) => c.json({ ok: true, name: c.env.APP_NAME, service: 'goodtown-api' }))
/** Liveness: the process is up (Docker HEALTHCHECK, App Platform health check). */
app.get('/health', (c) => c.json({ ok: true }))
/** Readiness: the database answers too. */
app.get('/ready', async (c) => {
  try {
    await getDb().command({ ping: 1 })
    return c.json({ ok: true })
  } catch {
    return c.json({ ok: false, code: 'internal', message: 'Database unreachable' }, 503)
  }
})

// Better Auth: OTP send/verify, session, sign-out. Sign-out also drops the cached session.
app.post('/api/auth/sign-out', async (c, next) => {
  evictSessionFrom(c.req.raw.headers)
  await next()
})
// Only the Better Auth endpoints the apps use are reachable; the rest of its catalogue (e.g. /update-user,
// which would bypass our name rules, or /open-api/*) answers 404.
app.on(['GET', 'POST'], '/api/auth/*', (c) => {
  const path = c.req.path.slice('/api/auth'.length)
  if (!BETTER_AUTH_PATHS.includes(path)) return c.json({ ok: false, code: 'not_found' }, 404)
  return createAuth(c.env).handler(c.req.raw)
})

// Goodtown domain.
app.route('/v1/auth', authRoutes)
app.route('/v1/signup', signupRoutes)
app.route('/v1/towns', townRoutes)
app.route('/v1/me', meRoutes)
app.route('/v1', feedRoutes)

// OpenAPI document + Scalar reference UI (mount after the routes so they are all in the document).
mountDocs(app)

/** The composed app. `server.ts` serves it on Node; tests can call `app.request()` directly. */
export default app
