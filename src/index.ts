import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import type { Env } from './env'
import { createAuth } from './auth'
import { errorResponse } from './lib/errors'
import { authRoutes } from './routes/auth'
import { signupRoutes } from './routes/signup'
import { townRoutes } from './routes/towns'
import { meRoutes } from './routes/me'
import { mountDocs } from './openapi/docs'

const app = new Hono<{ Bindings: Env }>()

app.use('*', logger())
app.use('*', secureHeaders())
app.onError(errorResponse)
app.notFound((c) => c.json({ ok: false, code: 'not_found' }, 404))

app.get('/', (c) => c.json({ ok: true, name: c.env.APP_NAME, service: 'goodtown-api' }))
app.get('/health', (c) => c.json({ ok: true }))

// Better Auth: OTP send/verify, session, sign-out.
app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))

// Goodtown domain.
app.route('/v1/auth', authRoutes)
app.route('/v1/signup', signupRoutes)
app.route('/v1/towns', townRoutes)
app.route('/v1/me', meRoutes)

// OpenAPI document + Scalar reference UI (mount after the routes so they are all in the document).
mountDocs(app)

export default app
