import { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import { z } from 'zod'
import type { Env } from '../env'
import { getDb } from '../db/client'
import { collections } from '../db/collections'
import { geo, type GeoTown } from '../geo/model'
import { isLivePoint, isLiveTown, launchTowns, nearestLaunch, type LaunchTown } from '../geo/live'
import { locatePoint } from '../geo/locate'
import { escapeRegex } from '../geo/names'
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

/**
 * The Town object the app sees. `geoid` is the Census place GEOID (Wichita 2079000); `county` is
 * the display form ("Sedgwick County"); `isLive` comes from the launch areas, not a stored flag.
 */
export function publicTown(t: GeoTown, launch: LaunchTown[], state: string) {
  return {
    geoid: t.geoid,
    name: t.name,
    kind: t.kind,
    state,
    county: t.countyName ? `${t.countyName} County` : '',
    isLive: isLiveTown(t, launch),
  }
}

/**
 * Flow map `locate(lat,lng)` + `coverage_at`.
 * → { resolution: "live" | "not_live", town } | { resolution: "outside_launch_area" }
 */
townRoutes.get(
  '/resolve',
  describeRoute({
    tags: ['Towns'],
    summary: 'Resolve the town for a location',
    description:
      'AuthLocation. County → place by Census boundaries; rural points snap to the nearest town centre within 40 km. ' +
      '`live` when the point is inside a launch area (Wichita, 25 mi) → AuthTown; `not_live` → NotHereYet; ' +
      'outside Kansas / no town nearby → `outside_launch_area` → AuthTownPick.',
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
    const db = getDb()
    const [located, launch] = await Promise.all([locatePoint(db, lng, lat), launchTowns(db)])
    if (!located.county || !located.town) return c.json({ ok: true, resolution: 'outside_launch_area' as const })
    const live = isLivePoint({ type: 'Point', coordinates: [lng, lat] }, launch)
    return c.json({
      ok: true,
      resolution: live ? ('live' as const) : ('not_live' as const),
      town: publicTown(located.town, launch, c.env.LAUNCH_STATE),
      neighborhood: located.neighborhood ? { id: located.neighborhood.id, name: located.neighborhood.name } : null,
    })
  },
)

/** Flow map `search_places` (towns only, launch state only). Prefix match on the name. */
townRoutes.get(
  '/search',
  describeRoute({
    tags: ['Towns'],
    summary: 'Search towns by name prefix',
    description:
      'AuthTownPick. Kansas cities and communities; live first, then cities before unincorporated communities; max 10.',
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
    const db = getDb()
    const [list, launch] = await Promise.all([
      geo(db)
        .towns.find({ name: { $regex: `^${escapeRegex(q)}`, $options: 'i' } }, { projection: { geometry: 0 } })
        .collation({ locale: 'en', strength: 2 })
        .sort({ name: 1 })
        .limit(40)
        .toArray(),
      launchTowns(db),
    ])
    const towns = list
      .map((t) => publicTown(t, launch, c.env.LAUNCH_STATE))
      .sort(
        (a, b) =>
          Number(b.isLive) - Number(a.isLive) ||
          Number(a.kind === 'community') - Number(b.kind === 'community') ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 10)
    return c.json({ ok: true, towns })
  },
)

townRoutes.get(
  '/:geoid/neighborhoods',
  describeRoute({
    tags: ['Towns'],
    summary: 'Neighborhoods of a town',
    description:
      'Active neighborhoods (City of Wichita associations for 2079000), A–Z. Empty for towns without a neighborhood layer.',
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
    const g = geo(getDb())
    const geoid = c.req.param('geoid')
    if (!(await g.towns.findOne({ geoid }, { projection: { _id: 1 } }))) throw new ApiError(404, 'not_found')
    const list = await g.neighborhoods
      .find({ townGeoid: geoid, active: true }, { projection: { id: 1, name: 1 } })
      .collation({ locale: 'en', strength: 2 })
      .sort({ name: 1 })
      .toArray()
    return c.json({ ok: true, neighborhoods: list.map((n) => ({ id: n.id, name: n.name })) })
  },
)

/** NotHereYet: demand so far + nearest live town. */
townRoutes.get(
  '/:geoid/interest',
  describeRoute({
    tags: ['Towns'],
    summary: 'Interest in an unopened town',
    description:
      'NotHereYet: how many neighbors want Goodtown here, whether this account already asked, and the nearest live town with the distance in miles.',
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
    const db = getDb()
    const { townRequests } = collections(db)
    const town = await geo(db).towns.findOne({ geoid }, { projection: { geometry: 0 } })
    if (!town) throw new ApiError(404, 'not_found')
    const [wantCount, mine, launch] = await Promise.all([
      townRequests.countDocuments({ geoid }),
      townRequests.findOne({ geoid, userId: user.id }),
      launchTowns(db),
    ])
    const nearest = nearestLaunch(town.center, launch)
    return c.json({
      ok: true,
      wantCount,
      alreadyRequested: !!mine,
      nearestLive: nearest ? publicTown(nearest.town, launch, c.env.LAUNCH_STATE) : null,
      nearestLiveMiles: nearest?.miles ?? null,
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
    const db = getDb()
    const { townRequests } = collections(db)
    if (!(await geo(db).towns.findOne({ geoid }, { projection: { _id: 1 } }))) throw new ApiError(404, 'not_found')
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
