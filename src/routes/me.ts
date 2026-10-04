import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env } from '../env'
import { getDb } from '../db/client'
import { collections } from '../db/collections'
import { ApiError } from '../lib/errors'
import { requireSession, type AppVariables } from '../middleware/session'

export const meRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()
meRoutes.use('*', requireSession)

/** Flow map `set_home_town(geoid)`; geoid null = browse mode ("Look around Wichita"). */
meRoutes.put(
  '/home-town',
  zValidator('json', z.object({ geoid: z.string().nullable(), neighborhoodId: z.string().nullable().optional() })),
  async (c) => {
    const user = c.get('user')
    const { geoid, neighborhoodId = null } = c.req.valid('json')
    const { profiles, towns } = collections(getDb(c.env))
    if (geoid) {
      const town = await towns.findOne({ geoid })
      if (!town) throw new ApiError(404, 'not_found', 'Unknown town')
      if (!town.isLive) throw new ApiError(422, 'validation', 'Goodtown is not open in this town yet')
      if (neighborhoodId && !town.neighborhoods.some((n) => n.id === neighborhoodId)) {
        throw new ApiError(422, 'validation', 'Unknown neighborhood')
      }
    }
    const res = await profiles.updateOne(
      { userId: user.id },
      { $set: { homeTownGeoid: geoid, neighborhoodId: geoid ? neighborhoodId : null, townStepDone: true, updatedAt: new Date() } },
    )
    if (res.matchedCount === 0) throw new ApiError(409, 'validation', 'Complete sign-up first')
    return c.json({ ok: true })
  },
)

/** Flow map `accept_terms(version)` — Neighbor promise "I agree". */
meRoutes.post('/terms', zValidator('json', z.object({ version: z.string().min(1) })), async (c) => {
  const user = c.get('user')
  const { version } = c.req.valid('json')
  if (version !== c.env.TERMS_VERSION) {
    throw new ApiError(409, 'validation', 'Outdated terms version', { current: c.env.TERMS_VERSION })
  }
  const { profiles } = collections(getDb(c.env))
  const res = await profiles.updateOne(
    { userId: user.id },
    { $set: { termsVersion: version, termsAcceptedAt: new Date(), updatedAt: new Date() } },
  )
  if (res.matchedCount === 0) throw new ApiError(409, 'validation', 'Complete sign-up first')
  return c.json({ ok: true })
})

/** Flow map `register_push_token` / `unregister_push_token`. */
meRoutes.post(
  '/push-token',
  zValidator('json', z.object({ token: z.string().min(8).max(4096), platform: z.enum(['android', 'ios']) })),
  async (c) => {
    const user = c.get('user')
    const { token, platform } = c.req.valid('json')
    const { profiles } = collections(getDb(c.env))
    await profiles.updateOne({ userId: user.id }, { $pull: { pushTokens: { token } } })
    await profiles.updateOne(
      { userId: user.id },
      { $push: { pushTokens: { token, platform, updatedAt: new Date() } }, $set: { updatedAt: new Date() } },
    )
    return c.json({ ok: true })
  },
)

meRoutes.delete('/push-token', zValidator('json', z.object({ token: z.string().min(8) })), async (c) => {
  const user = c.get('user')
  const { token } = c.req.valid('json')
  const { profiles } = collections(getDb(c.env))
  await profiles.updateOne({ userId: user.id }, { $pull: { pushTokens: { token } }, $set: { updatedAt: new Date() } })
  return c.json({ ok: true })
})
