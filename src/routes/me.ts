import { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import { z } from 'zod'
import type { Env } from '../env'
import { getDb } from '../db/client'
import { collections } from '../db/collections'
import { isLiveTown, launchTowns } from '../geo/live'
import { geo } from '../geo/model'
import { ApiError } from '../lib/errors'
import { requireSession, type AppVariables } from '../middleware/session'
import { validationHook } from '../lib/validate'
import { errorSchema, okSchema } from '../openapi/schemas'

export const meRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()
meRoutes.use('*', requireSession)

/** Flow map `set_home_town(geoid)`; geoid null = browse mode ("Look around Wichita"). */
meRoutes.put(
  '/home-town',
  describeRoute({
    tags: ['Me'],
    summary: 'Set home town (or browse mode)',
    description:
      'AuthTown. `geoid: null` = browse mode ("Look around Wichita"). Town must be live; neighborhood must belong to it.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Saved',
        content: { 'application/json': { schema: resolver(okSchema) } },
      },
      401: {
        description: 'No session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      404: {
        description: '`not_found`',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      409: {
        description: '`validation` — complete sign-up first / outdated terms version',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      422: {
        description: '`validation` — town not live / unknown neighborhood',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  validator(
    'json',
    z.object({
      geoid: z.string().nullable(),
      neighborhoodId: z.string().nullable().optional(),
    }),
    validationHook,
  ),
  async (c) => {
    const user = c.get('user')
    const { geoid, neighborhoodId = null } = c.req.valid('json')
    const db = getDb()
    const { profiles } = collections(db)
    if (geoid) {
      const g = geo(db)
      const town = await g.towns.findOne({ geoid }, { projection: { geometry: 0 } })
      if (!town) throw new ApiError(404, 'not_found', 'Unknown town')
      if (!isLiveTown(town, await launchTowns(db)))
        throw new ApiError(422, 'validation', 'Goodtown is not open in this town yet')
      if (
        neighborhoodId &&
        !(await g.neighborhoods.findOne(
          { id: neighborhoodId, townGeoid: geoid, active: true },
          { projection: { _id: 1 } },
        ))
      ) {
        throw new ApiError(422, 'validation', 'Unknown neighborhood')
      }
    }
    const res = await profiles.updateOne(
      { userId: user.id },
      {
        $set: {
          homeTownGeoid: geoid,
          neighborhoodId: geoid ? neighborhoodId : null,
          townStepDone: true,
          updatedAt: new Date(),
        },
      },
    )
    if (res.matchedCount === 0) throw new ApiError(409, 'validation', 'Complete sign-up first')
    return c.json({ ok: true })
  },
)

/** Flow map `accept_terms(version)` — Neighbor promise "I agree". */
meRoutes.post(
  '/terms',
  describeRoute({
    tags: ['Me'],
    summary: 'Accept the neighbor promise / terms',
    description:
      'AuthPromise "I agree". `version` must equal the current TERMS_VERSION (returned by GET /v1/auth/state).',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Accepted',
        content: { 'application/json': { schema: resolver(okSchema) } },
      },
      401: {
        description: 'No session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      409: {
        description: '`validation` — complete sign-up first / outdated terms version',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  validator('json', z.object({ version: z.string().min(1) }), validationHook),
  async (c) => {
    const user = c.get('user')
    const { version } = c.req.valid('json')
    if (version !== c.env.TERMS_VERSION) {
      throw new ApiError(409, 'validation', 'Outdated terms version', {
        current: c.env.TERMS_VERSION,
      })
    }
    const { profiles } = collections(getDb())
    const res = await profiles.updateOne(
      { userId: user.id },
      {
        $set: {
          termsVersion: version,
          termsAcceptedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    )
    if (res.matchedCount === 0) throw new ApiError(409, 'validation', 'Complete sign-up first')
    return c.json({ ok: true })
  },
)

/** Flow map `register_push_token` / `unregister_push_token`. */
meRoutes.post(
  '/push-token',
  describeRoute({
    tags: ['Me'],
    summary: 'Register a push token',
    description: 'AuthNotifications "Turn on notifications". Re-registering the same token replaces it.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Registered',
        content: { 'application/json': { schema: resolver(okSchema) } },
      },
      401: {
        description: 'No session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  validator(
    'json',
    z.object({
      token: z.string().min(8).max(4096),
      platform: z.enum(['android', 'ios']),
    }),
    validationHook,
  ),
  async (c) => {
    const user = c.get('user')
    const { token, platform } = c.req.valid('json')
    const { profiles } = collections(getDb())
    await profiles.updateOne({ userId: user.id }, { $pull: { pushTokens: { token } } })
    await profiles.updateOne(
      { userId: user.id },
      {
        $push: { pushTokens: { token, platform, updatedAt: new Date() } },
        $set: { updatedAt: new Date() },
      },
    )
    return c.json({ ok: true })
  },
)

meRoutes.delete(
  '/push-token',
  describeRoute({
    tags: ['Me'],
    summary: 'Unregister a push token',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Removed',
        content: { 'application/json': { schema: resolver(okSchema) } },
      },
      401: {
        description: 'No session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  validator('json', z.object({ token: z.string().min(8) }), validationHook),
  async (c) => {
    const user = c.get('user')
    const { token } = c.req.valid('json')
    const { profiles } = collections(getDb())
    await profiles.updateOne({ userId: user.id }, { $pull: { pushTokens: { token } }, $set: { updatedAt: new Date() } })
    return c.json({ ok: true })
  },
)
