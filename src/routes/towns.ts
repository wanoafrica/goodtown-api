import { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import { z } from 'zod'
import type { Env } from '../env'
import { getDb } from '../db/client'
import { collections, type Town } from '../db/collections'
import { ApiError } from '../lib/errors'
import { requireSession, type AppVariables } from '../middleware/session'
import { validationHook } from '../lib/validate'
import {
  errorSchema,
  interestResponse,
  neighborhoodsResponse,
  requestResponse,
  resolveResponse,
  searchResponse,
} from '../openapi/schemas'

export const townRoutes = new Hono<{
  Bindings: Env
  Variables: AppVariables
}>()

const publicTown = (t: Town) => ({
  geoid: t.geoid,
  name: t.name,
  state: t.state,
  county: t.county,
  isLive: t.isLive,
})

/** Kansas bounding box — the launch area. Anything outside → "outside launch area". */
const KANSAS = {
  minLat: 36.993,
  maxLat: 40.003,
  minLng: -102.052,
  maxLng: -94.588,
}

/**
 * Flow map `locate(lat,lng)` + `coverage_at`.
 * → { resolution: "live" | "not_live", town } | { resolution: "outside_launch_area" }
 */
townRoutes.get(
  '/resolve',
  describeRoute({
    tags: ['Towns'],
    summary: 'Resolve the nearest town for a location',
    description:
      'AuthLocation. Kansas bounding box first, then nearest town within 40 km. `live` → AuthTown, `not_live` → NotHereYet, `outside_launch_area` → AuthTownPick.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: resolver(resolveResponse) } },
      },
      401: {
        description: 'No session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  requireSession,
  validator(
    'query',
    z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
    }),
    validationHook,
  ),
  async (c) => {
    const { lat, lng } = c.req.valid('query')
    const inArea = lat >= KANSAS.minLat && lat <= KANSAS.maxLat && lng >= KANSAS.minLng && lng <= KANSAS.maxLng
    if (!inArea) return c.json({ ok: true, resolution: 'outside_launch_area' as const })

    const { towns } = collections(getDb(c.env))
    const town = await towns.findOne({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: 40_000,
        },
      },
    })
    if (!town) return c.json({ ok: true, resolution: 'outside_launch_area' as const })
    return c.json({
      ok: true,
      resolution: town.isLive ? ('live' as const) : ('not_live' as const),
      town: publicTown(town),
    })
  },
)

/** Flow map `search_places` (towns only, launch state only). Prefix match on the name. */
townRoutes.get(
  '/search',
  describeRoute({
    tags: ['Towns'],
    summary: 'Search towns by name prefix',
    description: 'AuthTownPick. Launch state only; live towns first; max 10.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: resolver(searchResponse) } },
      },
      401: {
        description: 'No session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  requireSession,
  validator('query', z.object({ q: z.string().trim().min(1).max(40) }), validationHook),
  async (c) => {
    const { q } = c.req.valid('query')
    const { towns } = collections(getDb(c.env))
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const list = await towns
      .find({
        state: c.env.LAUNCH_STATE,
        name: { $regex: `^${escaped}`, $options: 'i' },
      })
      .sort({ isLive: -1, name: 1 })
      .limit(10)
      .toArray()
    return c.json({ ok: true, towns: list.map(publicTown) })
  },
)

townRoutes.get(
  '/:geoid/neighborhoods',
  describeRoute({
    tags: ['Towns'],
    summary: 'Neighborhoods of a town',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': { schema: resolver(neighborhoodsResponse) },
        },
      },
      401: {
        description: 'No session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      404: {
        description: '`not_found`',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  requireSession,
  async (c) => {
    const { towns } = collections(getDb(c.env))
    const town = await towns.findOne({ geoid: c.req.param('geoid') }, { projection: { neighborhoods: 1 } })
    if (!town) throw new ApiError(404, 'not_found')
    return c.json({ ok: true, neighborhoods: town.neighborhoods })
  },
)

/** NotHereYet: demand so far + nearest live town. */
townRoutes.get(
  '/:geoid/interest',
  describeRoute({
    tags: ['Towns'],
    summary: 'Interest in an unopened town',
    description:
      'NotHereYet: how many neighbors want Goodtown here, whether this account already asked, and the nearest live town.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: resolver(interestResponse) } },
      },
      401: {
        description: 'No session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      404: {
        description: '`not_found`',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  requireSession,
  async (c) => {
    const user = c.get('user')
    const geoid = c.req.param('geoid')
    const { towns, townRequests } = collections(getDb(c.env))
    const town = await towns.findOne({ geoid })
    if (!town) throw new ApiError(404, 'not_found')
    const [wantCount, mine, nearestLive] = await Promise.all([
      townRequests.countDocuments({ geoid }),
      townRequests.findOne({ geoid, userId: user.id }),
      towns.findOne({
        isLive: true,
        location: { $near: { $geometry: town.location } },
      }),
    ])
    const miles = nearestLive
      ? Math.round(haversineKm(town.location.coordinates, nearestLive.location.coordinates) * 0.621371)
      : null
    return c.json({
      ok: true,
      wantCount,
      alreadyRequested: !!mine,
      nearestLive: nearestLive ? publicTown(nearestLive) : null,
      nearestLiveMiles: miles,
    })
  },
)

/** "I want Goodtown here" — one per account per town. */
townRoutes.post(
  '/:geoid/request',
  describeRoute({
    tags: ['Towns'],
    summary: '"I want Goodtown here"',
    description: 'One request per account per town; idempotent.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: resolver(requestResponse) } },
      },
      401: {
        description: 'No session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      404: {
        description: '`not_found`',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  requireSession,
  async (c) => {
    const user = c.get('user')
    const geoid = c.req.param('geoid')
    const { towns, townRequests } = collections(getDb(c.env))
    if (!(await towns.findOne({ geoid }, { projection: { _id: 1 } }))) throw new ApiError(404, 'not_found')
    await townRequests.updateOne(
      { geoid, userId: user.id },
      { $setOnInsert: { geoid, userId: user.id, createdAt: new Date() } },
      { upsert: true },
    )
    return c.json({
      ok: true,
      wantCount: await townRequests.countDocuments({ geoid }),
      alreadyRequested: true,
    })
  },
)

function haversineKm([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
