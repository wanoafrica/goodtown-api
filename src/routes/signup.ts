import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env } from '../env'
import { getDb } from '../db/client'
import { collections } from '../db/collections'
import { ApiError } from '../lib/errors'
import { identifierHash } from '../lib/hash'
import { requireSession, type AppVariables } from '../middleware/session'
import { isAdult, parseBirthdate } from '../domain/age'
import { normaliseName } from '../domain/name'

export const signupRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()

/**
 * Flow map `complete_signup(name, birthdate)` — AuthBirthday "Yes, that's right".
 * Creates the profile. Under 18 → permanent denial for this login (hash of the email).
 */
signupRoutes.post(
  '/complete',
  requireSession,
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(80),
      birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
  async (c) => {
    const user = c.get('user')
    const { name: rawName, birthdate: rawDate } = c.req.valid('json')
    const db = getDb(c.env)
    const { profiles, signupDenials } = collections(db)

    const hash = await identifierHash(user.email)
    if (await signupDenials.findOne({ identifierHash: hash, clearedAt: { $exists: false } })) {
      throw new ApiError(403, 'under_18')
    }

    const existing = await profiles.findOne({ userId: user.id })
    if (existing?.birthdate) throw new ApiError(409, 'already_completed', 'Birthday cannot be changed')

    const name = normaliseName(rawName)
    if (!name) throw new ApiError(422, 'invalid_name', 'Add a name so neighbors know who’s posting.')

    const birthdate = parseBirthdate(rawDate)
    if (!birthdate) throw new ApiError(422, 'invalid_date', 'That date doesn’t exist. Check the month and day.')

    if (!isAdult(birthdate)) {
      await signupDenials.updateOne(
        { identifierHash: hash },
        { $setOnInsert: { identifierHash: hash, reason: 'under_18', createdAt: new Date() } },
        { upsert: true },
      )
      throw new ApiError(403, 'under_18')
    }

    const now = new Date()
    await profiles.updateOne(
      { userId: user.id },
      {
        $set: { name, birthdate: rawDate, updatedAt: now },
        $setOnInsert: {
          userId: user.id,
          townStepDone: false,
          homeTownGeoid: null,
          neighborhoodId: null,
          termsVersion: null,
          termsAcceptedAt: null,
          pushTokens: [],
          suspended: false,
          createdAt: now,
        },
      },
      { upsert: true },
    )
    return c.json({ ok: true })
  },
)
