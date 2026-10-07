import { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import { z } from 'zod'
import type { Env } from '../env'
import { createAuth } from '../auth'
import { getDb } from '../db/client'
import { collections, isDenied } from '../db/collections'
import { validationHook } from '../lib/validate'
import { rateLimit } from '../middleware/rateLimit'
import { authStateResponse, emailCheckResponse, errorSchema } from '../openapi/schemas'
import { requireSession, type AppVariables } from '../middleware/session'
import { signupState } from '../domain/signupState'

export const authRoutes = new Hono<{
  Bindings: Env
  Variables: AppVariables
}>()

/**
 * Log-in pre-check (LoginEmail → LoginNoAccount). The product shows a
 * "no account" screen, so account existence is intentionally not hidden.
 * Sign-up skips this and calls the OTP endpoint directly.
 */
authRoutes.post(
  '/email/check',
  describeRoute({
    tags: ['Auth'],
    summary: 'Does an account exist for this email?',
    description:
      'Log-in pre-check (LoginEmail → LoginNoAccount). Public. Sign-up skips this and sends the OTP directly.',
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': { schema: resolver(emailCheckResponse) },
        },
      },
    },
  }),
  // Public and reveals whether an account exists, so throttle bulk lookups.
  rateLimit({ windowMs: 60_000, max: 10 }),
  validator('json', z.object({ email: z.email() }), validationHook),
  async (c) => {
    const { email } = c.req.valid('json')
    const auth = createAuth(c.env)
    const ctx = await auth.$context
    const user = await ctx.internalAdapter.findUserByEmail(email.trim().toLowerCase())
    return c.json({ ok: true, exists: !!user })
  },
)

/** Flow map `my_signup_state` — call after every verified code and on every launch. */
authRoutes.get(
  '/state',
  describeRoute({
    tags: ['Auth'],
    summary: 'Sign-up state for the current session',
    description: 'Call after every verified code and on every launch; the app resumes at the screen matching `state`.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': { schema: resolver(authStateResponse) },
        },
      },
      401: {
        description: 'No session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  requireSession,
  async (c) => {
    const user = c.get('user')
    const db = getDb()
    const [profile, denied] = await Promise.all([
      collections(db).profiles.findOne({ userId: user.id }),
      isDenied(db, user.email),
    ])
    const state = signupState(profile, denied, c.env.TERMS_VERSION)
    return c.json({
      ok: true,
      ...state,
      profile: profile
        ? {
            name: profile.name ?? null,
            homeTownGeoid: profile.homeTownGeoid,
            neighborhoodId: profile.neighborhoodId,
          }
        : null,
    })
  },
)
