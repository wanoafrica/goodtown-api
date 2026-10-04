import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env } from '../env'
import { createAuth } from '../auth'
import { getDb } from '../db/client'
import { collections } from '../db/collections'
import { identifierHash } from '../lib/hash'
import { requireSession, type AppVariables } from '../middleware/session'
import { signupState } from '../domain/signupState'

export const authRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()

/**
 * Log-in pre-check (LoginEmail → LoginNoAccount). The product shows a
 * "no account" screen, so account existence is intentionally not hidden.
 * Sign-up skips this and calls the OTP endpoint directly.
 */
authRoutes.post(
  '/email/check',
  zValidator('json', z.object({ email: z.email() })),
  async (c) => {
    const { email } = c.req.valid('json')
    const auth = createAuth(c.env)
    const ctx = await auth.$context
    const user = await ctx.internalAdapter.findUserByEmail(email.trim().toLowerCase())
    return c.json({ ok: true, exists: !!user })
  },
)

/** Flow map `my_signup_state` — call after every verified code and on every launch. */
authRoutes.get('/state', requireSession, async (c) => {
  const user = c.get('user')
  const db = getDb(c.env)
  const { profiles, signupDenials } = collections(db)
  const [profile, denial] = await Promise.all([
    profiles.findOne({ userId: user.id }),
    signupDenials.findOne({ identifierHash: await identifierHash(user.email), clearedAt: { $exists: false } }),
  ])
  const state = signupState(profile, !!denial, c.env.TERMS_VERSION)
  return c.json({
    ok: true,
    ...state,
    profile: profile
      ? { name: profile.name ?? null, homeTownGeoid: profile.homeTownGeoid, neighborhoodId: profile.neighborhoodId }
      : null,
  })
})
