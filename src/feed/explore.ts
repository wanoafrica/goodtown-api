import type { Db } from 'mongodb'
import { collections } from '../db/collections'
import { geo } from '../geo/model'
import { viewerTownGeoid } from './feed'
import { feedCollections } from './model'
import { tone } from './time'

/** How far back "local voices" and active neighborhoods look. */
const WINDOW_DAYS = 30
const VOICES = 10
const NEIGHBORHOODS = 6

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null
  let bestCount = 0
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v
      bestCount = n
    }
  }
  return best
}

/**
 * Explore (Figma 5:26) for the viewer's town ([userId] null = a guest: Wichita).
 * - Local voices: neighbors who posted most in the last 30 days, each with what they post about — their usual
 *   neighborhood and category ("Delano food").
 * - Original: the newest published Goodtown Original, or null.
 * - Neighborhoods: where people posted most in the last 30 days; A–Z when nobody has yet.
 */
export async function buildExplore(db: Db, userId: string | null, now: Date) {
  const { profiles } = collections(db)
  const f = feedCollections(db)
  const g = geo(db)
  const profile = userId ? await profiles.findOne({ userId }) : null
  const townGeoid = viewerTownGeoid(profile)
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000)
  const recent = { townGeoid, status: 'published' as const, createdAt: { $gte: since } }

  const [town, posters, original, busyHoods] = await Promise.all([
    g.towns.findOne({ geoid: townGeoid }, { projection: { name: 1 } }),
    f.posts
      .aggregate<{ _id: string; count: number; places: string[]; categories: (string | null)[] }>([
        { $match: { ...recent, authorType: 'user' } },
        { $group: { _id: '$authorUserId', count: { $sum: 1 }, places: { $push: '$place' }, categories: { $push: '$category' } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: VOICES * 2 },
      ])
      .toArray(),
    f.originals.find({ townGeoid, publishedAt: { $lte: now } }).sort({ publishedAt: -1 }).limit(1).next(),
    f.posts
      .aggregate<{ _id: string; count: number }>([
        { $match: { ...recent, neighborhoodId: { $ne: null } } },
        { $group: { _id: '$neighborhoodId', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: NEIGHBORHOODS },
      ])
      .toArray(),
  ])

  const names = await profiles
    .find({ userId: { $in: posters.map((p) => p._id) } }, { projection: { userId: 1, name: 1 } })
    .toArray()
  const firstName = new Map(names.map((p) => [p.userId, p.name?.trim().split(/\s+/)[0] ?? '']))
  const localVoices = posters
    .filter((p) => firstName.get(p._id))
    .slice(0, VOICES)
    .map((p) => {
      const place = mostCommon(p.places.filter(Boolean))
      const category = mostCommon(p.categories.filter((c): c is string => !!c))
      return {
        id: p._id,
        name: firstName.get(p._id)!,
        topic: [place, category].filter(Boolean).join(' ') || null,
        avatarTone: tone(p._id, 5),
      }
    })

  let neighborhoods: { id: string; name: string }[]
  if (busyHoods.length > 0) {
    const docs = await g.neighborhoods
      .find({ id: { $in: busyHoods.map((h) => h._id) }, active: true }, { projection: { id: 1, name: 1 } })
      .toArray()
    const byId = new Map(docs.map((d) => [d.id, d.name]))
    neighborhoods = busyHoods.flatMap((h) => (byId.has(h._id) ? [{ id: h._id, name: byId.get(h._id)! }] : []))
  } else {
    neighborhoods = (
      await g.neighborhoods
        .find({ townGeoid, active: true }, { projection: { id: 1, name: 1 } })
        .sort({ name: 1 })
        .limit(NEIGHBORHOODS)
        .toArray()
    ).map((d) => ({ id: d.id, name: d.name }))
  }

  return {
    town: { geoid: townGeoid, name: town?.name ?? 'Wichita' },
    localVoices,
    original: original
      ? {
          id: original._id!.toHexString(),
          title: original.title,
          place: original.place,
          minutes: Math.max(1, Math.round(original.durationSec / 60)),
          videoUrl: original.videoUrl,
        }
      : null,
    neighborhoods,
  }
}
