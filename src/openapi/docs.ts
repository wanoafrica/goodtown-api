import type { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { generateSpecs } from 'hono-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import type { Env } from '../env'
import { createAuth } from '../auth'

/** Better Auth endpoints the apps actually call; the rest of its catalogue is left out of our document. */
const AUTH_PATHS = ['/email-otp/send-verification-otp', '/sign-in/email-otp', '/get-session', '/sign-out']

/**
 * Mounts `GET /openapi.json` (OpenAPI 3.1 generated from the Zod validators and
 * `describeRoute` metadata, merged with the Better Auth OTP/session endpoints)
 * and `GET /docs` (Scalar API reference UI).
 */
export function mountDocs(app: Hono<{ Bindings: Env }>) {
  // Gate: both endpoints 404 unless DOCS_ENABLED=1 (set in .dev.vars; off in production).
  const gate = createMiddleware<{ Bindings: Env }>(async (c, next) => {
    if (c.env.DOCS_ENABLED !== '1') return c.json({ ok: false, code: 'not_found' }, 404)
    await next()
  })
  app.use('/docs', gate)
  app.use('/openapi.json', gate)

  app.get('/openapi.json', async (c) => {
    const spec = await generateSpecs(
      app,
      {
        documentation: {
          info: {
            title: 'Goodtown API',
            version: '1.0.0',
            description:
              'Backend for the Goodtown mobile apps. Sign-in is email OTP via Better Auth (`/api/auth/*`); ' +
              'every `/v1` route except `POST /v1/auth/email/check` needs `Authorization: Bearer <token>`. ' +
              'Errors always have the shape `{ ok:false, code, message?, details? }` — switch on `code`.',
          },
          servers: [{ url: new URL(c.req.url).origin }],
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                description: 'Session token returned by `POST /api/auth/sign-in/email-otp`',
              },
            },
          },
          tags: [
            {
              name: 'Better Auth',
              description: 'Email OTP send/verify, session, sign-out (served by Better Auth under /api/auth)',
            },
            {
              name: 'Auth',
              description: 'Account pre-check and sign-up state',
            },
            {
              name: 'Signup',
              description: 'Profile creation (name + birthday, 18+)',
            },
            {
              name: 'Towns',
              description: 'Launch-area towns: resolve by location, search, interest in unopened towns',
            },
            {
              name: 'Me',
              description: 'Home town, terms acceptance, push tokens',
            },
          ],
        },
        exclude: ['/openapi.json', '/docs', '/', '/health', /^\/api\/auth/],
      },
      c,
    )

    // Better Auth generates its own document with paths relative to /api/auth.
    const auth = createAuth(c.env)
    const authSchema = (await auth.api.generateOpenAPISchema()) as unknown as {
      paths: Record<string, Record<string, Record<string, unknown>>>
      components?: { schemas?: Record<string, never> }
    }
    for (const p of AUTH_PATHS) {
      const item = authSchema.paths[p]
      if (!item) continue
      const tagged = Object.fromEntries(Object.entries(item).map(([m, op]) => [m, { ...op, tags: ['Better Auth'] }]))
      spec.paths[`/api/auth${p}`] = tagged as (typeof spec.paths)[string]
    }
    spec.components.schemas = {
      ...(authSchema.components?.schemas ?? {}),
      ...(spec.components.schemas ?? {}),
    }

    return c.json(spec)
  })

  app.get(
    '/docs',
    Scalar({
      url: '/openapi.json',
      pageTitle: 'Goodtown API',
      theme: 'kepler',
    }),
  )
}
