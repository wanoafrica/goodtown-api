import { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import { z } from 'zod'
import type { Env } from '../env'
import { getDb } from '../db/client'
import { collections } from '../db/collections'
import { ApiError } from '../lib/errors'
import { identifierHash } from '../lib/hash'
import { validationHook } from '../lib/validate'
import { errorSchema, okSchema } from '../openapi/schemas'
import { requireSession, type AppVariables } from '../middleware/session'
import { isAdult, parseBirthdate } from '../domain/age'
import { normaliseName } from '../domain/name'

export const signupRoutes = new Hono<{
  Bindings: Env
  Variables: AppVariables
}>()

/**
 * Flow map `complete_signup(name, birthdate)` — AuthBirthday "Yes, that's right".
 * Creates the profile. Under 18 → permanent denial for this login (hash of the email).
 */
signupRoutes.post(
  '/complete',
  describeRoute({
    tags: ['Signup'],
    summary: 'Complete sign-up (name + birthday)',
    description:
      'AuthBirthday "Yes, that\'s right". Creates the profile. Under 18 → 403 `under_18` and a permanent denial for this email. ' +
      'Birthday cannot be changed once set (409 `already_completed`).',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Profile created',
        content: { 'application/json': { schema: resolver(okSchema) } },
      },
      401: {
        description: 'No session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      403: {
        description: '`under_18`',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      409: {
        description: '`already_completed`',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      422: {
        description: '`invalid_name` | `invalid_date`',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  requireSession,
  validator(
    'json',
    z.object({
      name: z.string().min(1).max(80).describe('Display name; trimmed and whitespace-collapsed server-side'),
      birthdate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe('YYYY-MM-DD'),
    }),
    validationHook,
  ),
  async (c) => {
    const user = c.get('user')
    const { name: rawName, birthdate: rawDate } = c.req.valid('json')
    const db = getDb()
    const { profiles, signupDenials } = collections(db)

    const hash = await identifierHash(user.email)
    if (
      await signupDenials.findOne({
        identifierHash: hash,
        clearedAt: { $exists: false },
      })
    ) {
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
        {
          $setOnInsert: {
            identifierHash: hash,
            reason: 'under_18',
            createdAt: new Date(),
          },
        },
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
