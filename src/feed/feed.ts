import { ObjectId, type Db, type Filter } from 'mongodb'
import { collections, type Profile } from '../db/collections'
import { geo, WICHITA_GEOID, type Point } from '../geo/model'
import { haversineM } from '../geo/names'
import { feedCollections, type Business, type FeedCategory, type Post, type Reaction, type TownEvent } from './model'
import { isOpenNow, startOfLocalDay, tone } from './time'

/** Videos per page; one event follows the first pair and one deal the event (the Figma order). */
export const PAGE_VIDEOS = 6
/** A new visit starts after this long away; posts since the previous visit count as "new". */
export const VISIT_GAP_MS = 30 * 60 * 1000

/** What the cursor remembers between pages so the feed stays consistent while you scroll. */
export interface FeedCursor {
  /** Last post shown: createdAt (ms) and id. */
  t: number
  id: string
  /** Events / deals already interleaved. */
  e: number
  d: number
  /** "New" baseline (ms) fixed at page one, whether a new post was shown, whether caught-up was emitted. */
  s: number
  n: boolean
  c: boolean
}

export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeCursor(raw: string): FeedCursor | null {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (typeof c.t === 'number' && typeof c.id === 'string' && ObjectId.isValid(c.id)) return c as FeedCursor
  } catch {
    // fall through
  }
  return null
}

/** The viewer's town: their home town, or Wichita while browsing as a visitor. */
export function viewerTownGeoid(profile: Profile | null): string {
  return profile?.homeTownGeoid ?? WICHITA_GEOID
}

/**
 * Visit bookkeeping on `profiles`: `townSeenAt` = last Town activity, `townBaselineAt` = when the previous
 * visit ended. Within a visit (gaps < 30 min) the baseline stays put, so the home header and every feed page
 * agree on what is "new". A first visit counts everything since the start of today.
 */
export async function touchVisit(db: Db, userId: string, now: Date): Promise<Date> {
  const { profiles } = collections(db)
  const profile = await profiles.findOne({ userId }, { projection: { townSeenAt: 1, townBaselineAt: 1 } })
  const seenAt = profile?.townSeenAt
  if (seenAt && now.getTime() - seenAt.getTime() < VISIT_GAP_MS && profile?.townBaselineAt) {
    await profiles.updateOne({ userId }, { $set: { townSeenAt: now } })
    return profile.townBaselineAt
  }
  const baseline = seenAt ?? startOfLocalDay(now)
  await profiles.updateOne({ userId }, { $set: { townSeenAt: now, townBaselineAt: baseline } })
  return baseline
}

function firstName(name: string | undefined | null): string | null {
  const first = name?.trim().split(/\s+/)[0]
  return first ? first : null
}

// MARK: - Home

/** Guests (no account) have no visits: "new" means since local midnight, and nothing is recorded. */
async function baselineFor(db: Db, userId: string | null, now: Date): Promise<Date> {
  return userId ? touchVisit(db, userId, now) : startOfLocalDay(now)
}

/** [userId] null = a guest looking around: Wichita, no first name. */
export async function buildHome(db: Db, userId: string | null, now: Date) {
  const { profiles } = collections(db)
  const f = feedCollections(db)
  const profile = userId ? await profiles.findOne({ userId }) : null
  const townGeoid = viewerTownGeoid(profile)
  const baseline = await baselineFor(db, userId, now)
  const today = startOfLocalDay(now)
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000)
  const published = { townGeoid, status: 'published' as const }

  const [town, newCount, todayVideos, todayEvents, todayDeals, posters] = await Promise.all([
    geo(db).towns.findOne({ geoid: townGeoid }, { projection: { name: 1 } }),
    f.posts.countDocuments({ ...published, createdAt: { $gt: baseline } }),
    f.posts.countDocuments({ ...published, createdAt: { $gte: today } }),
    f.events.countDocuments({ townGeoid, startsAt: { $gte: today, $lt: tomorrow } }),
    f.deals.countDocuments({ townGeoid, startsAt: { $lte: now }, endsAt: { $gt: now } }),
    f.posts
      .aggregate<{ _id: string; last: Date }>([
        { $match: { ...published, authorType: 'user', createdAt: { $gte: today } } },
        { $group: { _id: '$authorUserId', last: { $max: '$createdAt' } } },
        { $sort: { last: -1 } },
        { $limit: 10 },
      ])
      .toArray(),
  ])
  const names = await profiles
    .find({ userId: { $in: posters.map((p) => p._id) } }, { projection: { userId: 1, name: 1 } })
    .toArray()
  const nameById = new Map(names.map((p) => [p.userId, firstName(p.name)]))

  return {
    town: { geoid: townGeoid, name: town?.name ?? 'Wichita' },
    firstName: firstName(profile?.name),
    newSinceLastVisit: newCount,
    // No weather source yet; the apps hide the line when it is null.
    todayNote: null,
    today: { videos: todayVideos, events: todayEvents, deals: todayDeals },
    neighborsPostingToday: posters
      .filter((p) => nameById.get(p._id))
      .map((p) => ({ id: p._id, name: nameById.get(p._id)!, avatarTone: tone(p._id, 5) })),
  }
}

// MARK: - Feed page

export interface FeedAuthorOut {
  id: string
  name: string
  isBusiness: boolean
  isVerified: boolean
  avatarTone: number
}
export interface FeedBusinessOut {
  id: string
  name: string
  isVerified: boolean
  isOpenNow: boolean | null
  distanceMiles: number | null
  dealId: string | null
  thumbnailUrl: string | null
  thumbnailTone: number
}
export interface VideoItem {
  type: 'video'
  id: string
  author: FeedAuthorOut
  title: string
  quote: string | null
  place: string
  postedAt: string
  isNew: boolean
  videoUrl: string
  thumbnailUrl: string | null
  thumbnailTone: number
  business: FeedBusinessOut | null
  myReactions: Reaction[]
}
export interface EventItem {
  type: 'event'
  id: string
  title: string
  startsAt: string
  place: string
  category: string
  saved: boolean
}
export interface DealItem {
  type: 'deal'
  id: string
  title: string
  businessName: string
  endsAt: string
}
export type FeedItemOut = VideoItem | EventItem | DealItem | { type: 'caught_up' }
type Item = FeedItemOut

function eventFilter(townGeoid: string, from: Date, category: FeedCategory | null): Filter<TownEvent> {
  const base: Filter<TownEvent> = { townGeoid, startsAt: { $gte: from } }
  if (!category || category === 'events') return base
  return { ...base, category: { $regex: `^${category}$`, $options: 'i' } }
}

/** Deals only belong in All, Food and Shops. */
function dealsShown(category: FeedCategory | null) {
  return !category || category === 'food' || category === 'shops'
}

/** [userId] null = a guest: Wichita, no reactions or saves. */
export async function buildFeedPage(
  db: Db,
  userId: string | null,
  opts: { category: FeedCategory | null; cursor: FeedCursor | null; now: Date },
) {
  const { now, category } = opts
  const { profiles } = collections(db)
  const f = feedCollections(db)
  const profile = userId ? await profiles.findOne({ userId }) : null
  const townGeoid = viewerTownGeoid(profile)
  const baseline = opts.cursor ? new Date(opts.cursor.s) : await baselineFor(db, userId, now)

  const postFilter: Filter<Post> = { townGeoid, status: 'published' }
  if (category && category !== 'events') postFilter.category = category
  if (opts.cursor) {
    const at = new Date(opts.cursor.t)
    const id = new ObjectId(opts.cursor.id)
    postFilter.$or = [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: id } }]
  }

  const eventsSkip = opts.cursor?.e ?? 0
  const dealsSkip = opts.cursor?.d ?? 0
  const [posts, event, deal] = await Promise.all([
    category === 'events'
      ? Promise.resolve([] as Post[])
      : f.posts.find(postFilter).sort({ createdAt: -1, _id: -1 }).limit(PAGE_VIDEOS).toArray(),
    f.events
      .find(eventFilter(townGeoid, startOfLocalDay(now), category))
      .sort({ startsAt: 1, _id: 1 })
      .skip(eventsSkip)
      .limit(category === 'events' ? PAGE_VIDEOS : 1)
      .toArray(),
    dealsShown(category)
      ? f.deals
          .find({ townGeoid, startsAt: { $lte: now }, endsAt: { $gt: now } })
          .sort({ endsAt: 1, _id: 1 })
          .skip(dealsSkip)
          .limit(1)
          .toArray()
      : Promise.resolve([]),
  ])

  // Authors, businesses, the viewer's reactions and saves, in a few batched reads.
  const userIds = [...new Set(posts.flatMap((p) => (p.authorUserId ? [p.authorUserId] : [])))]
  const businessIds = [
    ...new Set([...posts.flatMap((p) => (p.businessId ? [p.businessId] : [])), ...deal.map((d) => d.businessId)]),
  ]
  const postIds = posts.map((p) => p._id!.toHexString())
  const eventIds = event.map((e) => e._id!.toHexString())
  const [authors, businesses, reactions, saves, liveDeals, viewerPoint] = await Promise.all([
    profiles.find({ userId: { $in: userIds } }, { projection: { userId: 1, name: 1 } }).toArray(),
    f.businesses.find({ businessId: { $in: businessIds } }).toArray(),
    userId ? f.reactions.find({ userId, postId: { $in: postIds } }).toArray() : Promise.resolve([]),
    userId ? f.eventSaves.find({ userId, eventId: { $in: eventIds } }).toArray() : Promise.resolve([]),
    f.deals
      .find(
        { businessId: { $in: businessIds }, startsAt: { $lte: now }, endsAt: { $gt: now } },
        { projection: { businessId: 1 } },
      )
      .toArray(),
    viewerPointOf(db, profile, townGeoid),
  ])
  const authorName = new Map(authors.map((a) => [a.userId, firstName(a.name) ?? '']))
  const businessById = new Map(businesses.map((b) => [b.businessId, b]))
  const dealByBusiness = new Map(liveDeals.map((d) => [d.businessId, d._id!.toHexString()]))
  const reactionsByPost = new Map<string, Reaction[]>()
  for (const r of reactions) reactionsByPost.set(r.postId, [...(reactionsByPost.get(r.postId) ?? []), r.reaction])
  const saved = new Set(saves.map((s) => s.eventId))

  const publicBusiness = (b: Business): FeedBusinessOut => ({
    id: b.businessId,
    name: b.name,
    isVerified: b.isVerified,
    isOpenNow: isOpenNow(b.hours, now),
    distanceMiles:
      b.location && viewerPoint
        ? Math.round((haversineM(viewerPoint.coordinates, b.location.coordinates) / 1609.344) * 10) / 10
        : null,
    dealId: dealByBusiness.get(b.businessId) ?? null,
    thumbnailUrl: b.thumbnailUrl,
    thumbnailTone: tone(b.businessId, 4),
  })

  const video = (p: Post): VideoItem => {
    const id = p._id!.toHexString()
    const business = p.businessId ? businessById.get(p.businessId) : undefined
    const author: FeedAuthorOut =
      p.authorType === 'business' && business
        ? {
            id: business.businessId,
            name: business.name,
            isBusiness: true,
            isVerified: business.isVerified,
            avatarTone: tone(business.businessId, 5),
          }
        : {
            id: p.authorUserId ?? '',
            name: authorName.get(p.authorUserId ?? '') ?? '',
            isBusiness: false,
            isVerified: false,
            avatarTone: tone(p.authorUserId ?? id, 5),
          }
    return {
      type: 'video',
      id,
      author,
      title: p.title,
      quote: p.quote,
      place: p.place,
      postedAt: p.createdAt.toISOString(),
      isNew: p.createdAt > baseline,
      videoUrl: p.videoUrl,
      thumbnailUrl: p.thumbnailUrl,
      thumbnailTone: tone(id, 4),
      business: business ? publicBusiness(business) : null,
      myReactions: reactionsByPost.get(id) ?? [],
    }
  }

  const eventItem = (e: TownEvent): EventItem => ({
    type: 'event',
    id: e._id!.toHexString(),
    title: e.title,
    startsAt: e.startsAt.toISOString(),
    place: e.place,
    category: e.category,
    saved: saved.has(e._id!.toHexString()),
  })

  // Assemble: v v [event] [deal] v v v v — with "caught up" where new posts give way to older ones.
  const items: Item[] = []
  let shownNew = opts.cursor?.n ?? false
  let caughtUp = opts.cursor?.c ?? false
  const pushVideo = (p: Post) => {
    const isNew = p.createdAt > baseline
    if (!isNew && shownNew && !caughtUp) {
      items.push({ type: 'caught_up' })
      caughtUp = true
    }
    if (isNew) shownNew = true
    items.push(video(p))
  }
  if (category === 'events') {
    event.forEach((e) => items.push(eventItem(e)))
  } else {
    posts.slice(0, 2).forEach(pushVideo)
    event.forEach((e) => items.push(eventItem(e)))
    deal.forEach((d) =>
      items.push({
        type: 'deal',
        id: d._id!.toHexString(),
        title: d.title,
        businessName: businessById.get(d.businessId)?.name ?? '',
        endsAt: d.endsAt.toISOString(),
      }),
    )
    posts.slice(2).forEach(pushVideo)
  }
  // Every new post shown and nothing older on this page: close "today" once the feed runs out of new posts.
  const fullPage = category === 'events' ? event.length === PAGE_VIDEOS : posts.length === PAGE_VIDEOS
  if (!fullPage && shownNew && !caughtUp) {
    items.push({ type: 'caught_up' })
    caughtUp = true
  }

  const last = posts[posts.length - 1]
  const nextCursor = fullPage
    ? encodeCursor({
        t: category === 'events' ? 0 : last!.createdAt.getTime(),
        id: category === 'events' ? new ObjectId().toHexString() : last!._id!.toHexString(),
        e: eventsSkip + event.length,
        d: dealsSkip + deal.length,
        s: baseline.getTime(),
        n: shownNew,
        c: caughtUp,
      })
    : null

  return { items, nextCursor }
}

/** Distance origin: the viewer's home neighborhood centre, else their town's centre. Never their device. */
async function viewerPointOf(db: Db, profile: Profile | null, townGeoid: string): Promise<Point | null> {
  const g = geo(db)
  if (profile?.neighborhoodId) {
    const n = await g.neighborhoods.findOne({ id: profile.neighborhoodId }, { projection: { center: 1 } })
    if (n) return n.center
  }
  const t = await g.towns.findOne({ geoid: townGeoid }, { projection: { center: 1 } })
  return t?.center ?? null
}
