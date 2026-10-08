import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import type { Db } from 'mongodb'
import { closeMongo, connectMongo, getDb } from '../src/db/client'
import { collections, ensureIndexes } from '../src/db/collections'
import {
  buildFeedPage,
  buildHome,
  decodeCursor,
  encodeCursor,
  PAGE_VIDEOS,
  type FeedItemOut,
  type VideoItem,
} from '../src/feed/feed'
import { ensureFeedIndexes, feedCollections, type Post } from '../src/feed/model'
import { isOpenNow, startOfLocalDay, tone } from '../src/feed/time'
import { WICHITA_GEOID } from '../src/geo/model'
import type { Env } from '../src/env'
import { loadEnv } from '../src/env'

// In-memory MongoDB (replica set: Better Auth's adapter uses transactions). Never touches Atlas.
let mongo: MongoMemoryReplSet
let db: Db
let env: Env
const user = 'user-viewer'
const now = new Date('2026-10-07T17:00:00Z') // noon in Wichita (CDT)

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  env = loadEnv({
    MONGODB_URI: mongo.getUri(),
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:8080',
    OTP_DEBUG_LOG: '1',
  })
  connectMongo(env)
  db = getDb()
  await Promise.all([ensureIndexes(db), ensureFeedIndexes(db)])
}, 120_000)

afterAll(async () => {
  await closeMongo()
  await mongo?.stop()
})

const videos = (items: FeedItemOut[]) => items.filter((i): i is VideoItem => i.type === 'video')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000)

function post(i: number, createdAt: Date, extra: Partial<Post> = {}): Post {
  return {
    townGeoid: WICHITA_GEOID,
    neighborhoodId: null,
    place: 'Delano',
    authorType: 'user',
    authorUserId: `author-${i % 3}`,
    businessId: null,
    title: `Post ${i}`,
    quote: null,
    category: i % 2 ? 'food' : 'outdoors',
    videoUrl: `https://example.com/${i}.mp4`,
    thumbnailUrl: null,
    status: 'published',
    createdAt,
    ...extra,
  }
}

beforeEach(async () => {
  await Promise.all(
    ['profiles', 'posts', 'events', 'deals', 'businesses', 'postReactions', 'eventSaves'].map((c) =>
      db.collection(c).deleteMany({}),
    ),
  )
  const { profiles } = collections(db)
  await profiles.insertMany(
    [user, 'author-0', 'author-1', 'author-2'].map((userId, i) => ({
      userId,
      name: ['Viewer Person', 'Maria', 'James', 'Ana'][i],
      townStepDone: true,
      homeTownGeoid: WICHITA_GEOID,
      neighborhoodId: null,
      termsVersion: '2026-10',
      termsAcceptedAt: now,
      pushTokens: [],
      suspended: false,
      createdAt: now,
      updatedAt: now,
    })),
  )
})

describe('time helpers', () => {
  it('starts the local day at Wichita midnight', () => {
    expect(startOfLocalDay(now).toISOString()).toBe('2026-10-07T05:00:00.000Z')
  })
  it('knows opening hours in local time', () => {
    const hours = [{ day: 3, open: '07:00', close: '14:00' }] // Wednesday
    expect(isOpenNow(hours, now)).toBe(true)
    expect(isOpenNow(hours, new Date('2026-10-07T20:00:00Z'))).toBe(false)
    expect(isOpenNow([], now)).toBeNull()
  })
  it('gives stable tones', () => {
    expect(tone('abc', 5)).toBe(tone('abc', 5))
    expect(tone('abc', 5)).toBeLessThan(5)
  })
  it('round-trips the cursor and rejects junk', () => {
    const c = { t: 1, id: '0123456789abcdef01234567', e: 1, d: 0, s: 2, n: true, c: false }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
    expect(decodeCursor('nope')).toBeNull()
  })
})

describe('feed', () => {
  it('pages newest first with the event and deal after the first pair, and never repeats', async () => {
    const f = feedCollections(db)
    await f.posts.insertMany(Array.from({ length: 9 }, (_, i) => post(i, hoursAgo(i + 1))))
    await f.events.insertOne({
      townGeoid: WICHITA_GEOID,
      title: 'Farmers market',
      startsAt: new Date(now.getTime() + 86400_000),
      place: 'Old Town',
      category: 'Family',
      businessId: null,
      createdAt: now,
    })
    await f.businesses.insertOne({
      businessId: 'b_bakery',
      name: 'Sunrise Bakehouse',
      townGeoid: WICHITA_GEOID,
      neighborhoodId: null,
      location: null,
      isVerified: true,
      hours: [],
      thumbnailUrl: null,
      createdAt: now,
    })
    await f.deals.insertOne({
      townGeoid: WICHITA_GEOID,
      businessId: 'b_bakery',
      title: 'Deal: 2-for-1 rolls',
      startsAt: hoursAgo(1),
      endsAt: new Date(now.getTime() + 3600_000),
      createdAt: now,
    })

    const first = await buildFeedPage(db, user, { category: null, cursor: null, now })
    expect(first.items.map((i) => i.type)).toEqual([
      'video',
      'video',
      'event',
      'deal',
      'video',
      'video',
      'video',
      'video',
    ])
    expect(first.items[0]).toMatchObject({ title: 'Post 0', author: { name: 'Maria', isBusiness: false } })
    expect(first.nextCursor).not.toBeNull()

    const second = await buildFeedPage(db, user, { category: null, cursor: decodeCursor(first.nextCursor!), now })
    const titles = videos([...first.items, ...second.items]).map((v) => v.title)
    expect(titles).toEqual(Array.from({ length: 9 }, (_, i) => `Post ${i}`))
    expect(second.nextCursor).toBeNull()
  })

  it('marks new posts since the previous visit and puts "caught up" between new and older', async () => {
    const f = feedCollections(db)
    // Previous visit ended 3h ago (more than the 30 min gap before now).
    await collections(db).profiles.updateOne(
      { userId: user },
      { $set: { townSeenAt: hoursAgo(3), townBaselineAt: hoursAgo(20) } },
    )
    await f.posts.insertMany([post(0, hoursAgo(1)), post(1, hoursAgo(2)), post(2, hoursAgo(5)), post(3, hoursAgo(6))])

    const home = await buildHome(db, user, now)
    expect(home.newSinceLastVisit).toBe(2)
    expect(home.firstName).toBe('Viewer')
    expect(home.neighborsPostingToday.map((n) => n.name).sort()).toEqual(['Ana', 'James', 'Maria'])

    const page = await buildFeedPage(db, user, { category: null, cursor: null, now })
    expect(page.items.map((i) => (i.type === 'video' ? `v${i.isNew ? '+' : '-'}` : i.type))).toEqual([
      'v+',
      'v+',
      'caught_up',
      'v-',
      'v-',
    ])
  })

  it('filters by category, lists events only for "events", and returns my reactions', async () => {
    const f = feedCollections(db)
    const ids = (await f.posts.insertMany(Array.from({ length: 4 }, (_, i) => post(i, hoursAgo(i + 1))))).insertedIds
    await f.reactions.insertOne({ postId: ids[1]!.toHexString(), userId: user, reaction: 'love', createdAt: now })
    await f.events.insertOne({
      townGeoid: WICHITA_GEOID,
      title: 'Story hour',
      startsAt: new Date(now.getTime() + 3600_000),
      place: 'Delano',
      category: 'Family',
      businessId: null,
      createdAt: now,
    })

    const food = await buildFeedPage(db, user, { category: 'food', cursor: null, now })
    const foodVideos = videos(food.items)
    expect(foodVideos.map((v) => v.title)).toEqual(['Post 1', 'Post 3'])
    expect(foodVideos[0]!.myReactions).toEqual(['love'])

    const events = await buildFeedPage(db, user, { category: 'events', cursor: null, now })
    expect(events.items.map((i) => i.type)).toEqual(['event'])
    expect(events.nextCursor).toBeNull()
  })

  it('serves a guest (no account): Wichita, new since midnight, nothing of mine, no visit recorded', async () => {
    const f = feedCollections(db)
    const ids = (
      await f.posts.insertMany([post(0, hoursAgo(1)), post(1, hoursAgo(2)), post(2, hoursAgo(14))])
    ).insertedIds
    await f.reactions.insertOne({ postId: ids[0]!.toHexString(), userId: user, reaction: 'love', createdAt: now })
    const profilesBefore = await collections(db).profiles.find().toArray()

    const home = await buildHome(db, null, now)
    expect(home.town.geoid).toBe(WICHITA_GEOID)
    expect(home.firstName).toBeNull()
    expect(home.newSinceLastVisit).toBe(2)

    const page = await buildFeedPage(db, null, { category: null, cursor: null, now })
    expect(page.items.map((i) => (i.type === 'video' ? `v${i.isNew ? '+' : '-'}` : i.type))).toEqual([
      'v+',
      'v+',
      'caught_up',
      'v-',
    ])
    expect(videos(page.items).every((v) => v.myReactions.length === 0)).toBe(true)
    expect(await collections(db).profiles.find().toArray()).toEqual(profilesBefore)
  })

  it('pages a full page size', () => {
    expect(PAGE_VIDEOS).toBe(6)
  })
})

describe('feed routes over HTTP (real Better Auth session)', () => {
  async function bearer(): Promise<string> {
    const { createAuth } = await import('../src/auth')
    const ctx = await createAuth(env).$context
    const u = await ctx.internalAdapter.createUser(
      { email: `http-${Date.now()}@example.com`, name: '', emailVerified: true },
      { method: 'email-otp' },
    )
    await collections(db).profiles.updateOne(
      { userId: u.id },
      { $set: { userId: u.id, name: 'Http', homeTownGeoid: WICHITA_GEOID, townStepDone: true } },
      { upsert: true },
    )
    const s = await ctx.internalAdapter.createSession(u.id)
    return s.token
  }

  it('serves home and feed, toggles a reaction and an event save, rejects bad input', async () => {
    const { default: app } = await import('../src/index')
    const f = feedCollections(db)
    const postId = (await f.posts.insertOne(post(0, new Date(Date.now() - 3600_000)))).insertedId.toHexString()
    const eventId = (
      await f.events.insertOne({
        townGeoid: WICHITA_GEOID,
        title: 'Market',
        startsAt: new Date(Date.now() + 86400_000),
        place: 'Old Town',
        category: 'Family',
        businessId: null,
        createdAt: new Date(),
      })
    ).insertedId.toHexString()
    const auth = { Authorization: `Bearer ${await bearer()}` }
    const call = (path: string, method = 'GET') => app.request(path, { method, headers: auth }, env)

    // Guests may read; writes and dead credentials answer 401.
    const guest = await (await app.request('/v1/feed', {}, env)).json()
    expect(guest).toMatchObject({ ok: true })
    expect(await (await app.request('/v1/town/home', {}, env)).json()).toMatchObject({ ok: true, firstName: null })
    expect((await app.request(`/v1/posts/${postId}/reactions/love`, { method: 'PUT' }, env)).status).toBe(401)
    expect((await app.request(`/v1/events/${eventId}/save`, { method: 'PUT' }, env)).status).toBe(401)
    expect((await app.request('/v1/feed', { headers: { Authorization: 'Bearer nope' } }, env)).status).toBe(401)

    const home = await (await call('/v1/town/home')).json()
    expect(home).toMatchObject({ ok: true, town: { geoid: WICHITA_GEOID }, firstName: 'Http' })

    type FeedJson = { ok: boolean; items: Array<{ type: string; id?: string; myReactions?: string[] }> }
    const feed = (await (await call('/v1/feed?category=all')).json()) as FeedJson
    expect(feed.ok).toBe(true)
    expect(feed.items.find((i) => i.type === 'video')?.id).toBe(postId)

    expect(await (await call(`/v1/posts/${postId}/reactions/love`, 'PUT')).json()).toEqual({ ok: true, active: true })
    const again = (await (await call('/v1/feed')).json()) as FeedJson
    expect(again.items.find((i) => i.id === postId)?.myReactions).toEqual(['love'])
    expect(await (await call(`/v1/posts/${postId}/reactions/love`, 'DELETE')).json()).toEqual({
      ok: true,
      active: false,
    })

    expect(await (await call(`/v1/events/${eventId}/save`, 'PUT')).json()).toEqual({ ok: true, active: true })
    expect((await call(`/v1/posts/${postId}/reactions/hug`, 'PUT')).status).toBe(400)
    expect((await call('/v1/posts/0123456789abcdef01234567/reactions/love', 'PUT')).status).toBe(404)
    expect((await call('/v1/feed?cursor=junk')).status).toBe(400)
  })
})
