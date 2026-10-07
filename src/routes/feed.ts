import { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import { ObjectId } from 'mongodb'
import { z } from 'zod'
import type { Env } from '../env'
import { getDb } from '../db/client'
import { buildFeedPage, buildHome, decodeCursor } from '../feed/feed'
import { FEED_CATEGORIES, feedCollections, REACTIONS } from '../feed/model'
import { ApiError } from '../lib/errors'
import { validationHook } from '../lib/validate'
import { requireSession, type AppVariables } from '../middleware/session'
import { errorSchema, feedResponse, toggleResponse, townHomeResponse } from '../openapi/schemas'

/**
 * Town tab + Player (Figma Main 5:628, Player 5:2408). Mounted at /v1:
 *   GET    /v1/town/home                         header: greeting, today counts, neighbors posting today
 *   GET    /v1/feed?category&cursor              the endless feed, a page at a time
 *   PUT    /v1/posts/:id/reactions/:reaction     want_to_go · love · been_there · save · thanks
 *   DELETE /v1/posts/:id/reactions/:reaction
 *   PUT    /v1/events/:id/save                   "Save" on an event card
 *   DELETE /v1/events/:id/save
 */
export const feedRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()

feedRoutes.use('*', requireSession)

const noSession = {
  401: { description: 'No session', content: { 'application/json': { schema: resolver(errorSchema) } } },
}
const notFound = {
  404: { description: '`not_found`', content: { 'application/json': { schema: resolver(errorSchema) } } },
}

feedRoutes.get(
  '/town/home',
  describeRoute({
    tags: ['Feed'],
    summary: 'Town header',
    description:
      'Greeting, "N new since you last looked", today counts and neighbors posting today, for the viewer’s home town ' +
      '(Wichita while browsing). Also starts a visit: posts after the previous visit are "new" (30 min gap = new visit).',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: resolver(townHomeResponse) } } },
      ...noSession,
    },
  }),
  async (c) => c.json({ ok: true, ...(await buildHome(getDb(), c.get('user').id, new Date())) }),
)

feedRoutes.get(
  '/feed',
  describeRoute({
    tags: ['Feed'],
    summary: 'Town feed page',
    description:
      'Newest first. Each page: up to 6 videos with one upcoming event after the first two and one live deal after the ' +
      'event; `caught_up` once where new posts give way to older ones. `category=events` lists events only. ' +
      'Pass `nextCursor` back as `cursor`; null means the end.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: resolver(feedResponse) } } },
      ...noSession,
    },
  }),
  validator(
    'query',
    z.object({
      category: z.enum(['all', ...FEED_CATEGORIES]).optional(),
      cursor: z.string().max(512).optional(),
    }),
    validationHook,
  ),
  async (c) => {
    const { category, cursor: rawCursor } = c.req.valid('query')
    const cursor = rawCursor ? decodeCursor(rawCursor) : null
    if (rawCursor && !cursor) throw new ApiError(400, 'validation', 'Invalid cursor')
    const page = await buildFeedPage(getDb(), c.get('user').id, {
      category: !category || category === 'all' ? null : category,
      cursor,
      now: new Date(),
    })
    return c.json({ ok: true, ...page })
  },
)

const idParam = z.object({ id: z.string().refine(ObjectId.isValid, 'not an id') })

for (const method of ['put', 'delete'] as const) {
  const active = method === 'put'

  feedRoutes[method](
    '/posts/:id/reactions/:reaction',
    describeRoute({
      tags: ['Feed'],
      summary: active ? 'Add a reaction to a video' : 'Remove a reaction from a video',
      description: 'Player rail: Want to go, Love this, Been there, Save, Thanks. Idempotent.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'OK', content: { 'application/json': { schema: resolver(toggleResponse) } } },
        ...noSession,
        ...notFound,
      },
    }),
    validator('param', idParam.extend({ reaction: z.enum(REACTIONS) }), validationHook),
    async (c) => {
      const { id, reaction } = c.req.valid('param')
      const userId = c.get('user').id
      const f = feedCollections(getDb())
      if (!(await f.posts.findOne({ _id: new ObjectId(id), status: 'published' }, { projection: { _id: 1 } }))) {
        throw new ApiError(404, 'not_found', 'Unknown video')
      }
      if (active) {
        await f.reactions.updateOne(
          { postId: id, userId, reaction },
          { $setOnInsert: { postId: id, userId, reaction, createdAt: new Date() } },
          { upsert: true },
        )
      } else {
        await f.reactions.deleteOne({ postId: id, userId, reaction })
      }
      return c.json({ ok: true, active })
    },
  )

  feedRoutes[method](
    '/events/:id/save',
    describeRoute({
      tags: ['Feed'],
      summary: active ? 'Save an event' : 'Unsave an event',
      description: 'Event card "Save". Idempotent.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'OK', content: { 'application/json': { schema: resolver(toggleResponse) } } },
        ...noSession,
        ...notFound,
      },
    }),
    validator('param', idParam, validationHook),
    async (c) => {
      const { id } = c.req.valid('param')
      const userId = c.get('user').id
      const f = feedCollections(getDb())
      if (!(await f.events.findOne({ _id: new ObjectId(id) }, { projection: { _id: 1 } }))) {
        throw new ApiError(404, 'not_found', 'Unknown event')
      }
      if (active) {
        await f.eventSaves.updateOne(
          { eventId: id, userId },
          { $setOnInsert: { eventId: id, userId, createdAt: new Date() } },
          { upsert: true },
        )
      } else {
        await f.eventSaves.deleteOne({ eventId: id, userId })
      }
      return c.json({ ok: true, active })
    },
  )
}
