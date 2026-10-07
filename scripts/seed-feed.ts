/**
 * Demo content for the Town feed and Player until real uploads exist (Upload screen not built yet):
 * verified businesses in real Wichita neighborhoods, posts with public sample clips, upcoming events and
 * today's deals. Every document carries `seed: true`.
 *
 *   npm run seed:feed            add (or refresh) the demo content
 *   npm run seed:feed -- --remove   delete every seeded document again
 *
 * Posts are attributed to existing user profiles (round-robin) or to the demo businesses; nothing here
 * creates accounts. Uses MONGODB_URI from .env — the single `goodtown` database, so remove the demo content
 * before real launch.
 */
import { existsSync } from 'node:fs'
import { MongoClient } from 'mongodb'
import { DB_NAME } from '../src/db/client'
import { feedCollections, type Business, type Deal, type Post, type TownEvent } from '../src/feed/model'
import { startOfLocalDay } from '../src/feed/time'
import { WICHITA_GEOID } from '../src/geo/model'

// An already-set MONGODB_URI wins over .env (tests point the script at a throwaway database).
if (!process.env.MONGODB_URI && existsSync('.env')) process.loadEnvFile('.env')
const uri = process.env.MONGODB_URI
if (!uri) throw new Error('MONGODB_URI is not set')

const CLIPS = [
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://media.w3.org/2010/05/bunny/trailer.mp4',
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8',
  'https://media.w3.org/2010/05/sintel/trailer.mp4',
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8',
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8',
]
const PLACES = ['Delano', 'Riverside', 'Old Town', 'College Hill', 'Midtown']
const NEIGHBOR_POSTS: Array<[string, Post['category']]> = [
  ['Sunset at the river path', 'outdoors'],
  ['Kids loved the splash pad', 'family'],
  ['First snow on the Keeper', 'outdoors'],
  ['Porch concert tonight', 'events'],
  ['Our street’s garden tour', 'family'],
  ['Best tacos on Broadway', 'food'],
]
const BUSINESS_POSTS: Array<[string, string | null]> = [
  ['Today’s special: cinnamon rolls', null],
  ['Best cinnamon rolls on Douglas — get there before 10!', 'They come out of the oven at 7…'],
  ['New fall menu is here', null],
  ['Parked at the Delano lot until 2', null],
]

async function main() {
  const client = new MongoClient(uri!)
  await client.connect()
  const db = client.db(DB_NAME)
  const f = feedCollections(db)

  if (process.argv.includes('--remove')) {
    const counts = await Promise.all(
      [f.posts, f.events, f.deals, f.businesses].map((c) => c.deleteMany({ seed: true })),
    )
    const [posts, events, deals, businesses] = counts.map((r) => r.deletedCount)
    console.log(`removed ${posts} posts, ${events} events, ${deals} deals, ${businesses} businesses`)
    await client.close()
    return
  }

  const now = new Date()
  const today = startOfLocalDay(now)
  const neighborhoods = await db
    .collection<{ id: string; name: string; center: { type: 'Point'; coordinates: [number, number] } }>(
      'geo_neighborhoods',
    )
    .find(
      { townGeoid: WICHITA_GEOID, name: { $in: PLACES.map((p) => p.toUpperCase()).concat(PLACES) } },
      { projection: { id: 1, name: 1, center: 1 } },
    )
    .toArray()
  const hood = (place: string) => neighborhoods.find((n) => n.name.toLowerCase() === place.toLowerCase()) ?? null
  const weekdays = (open: string, close: string) => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open, close }))

  const businesses: Business[] = [
    { businessId: 'b_seed_bakehouse', name: 'Sunrise Bakehouse', place: 'Delano', hours: weekdays('07:00', '15:00') },
    { businessId: 'b_seed_coffee', name: 'Corner Coffee', place: 'Old Town', hours: weekdays('06:00', '18:00') },
    { businessId: 'b_seed_tacos', name: 'Prairie Taco Truck', place: 'Midtown', hours: weekdays('11:00', '21:00') },
  ].map((b) => ({
    businessId: b.businessId,
    name: b.name,
    townGeoid: WICHITA_GEOID,
    neighborhoodId: hood(b.place)?.id ?? null,
    location: hood(b.place)?.center ?? null,
    isVerified: true,
    hours: b.hours,
    thumbnailUrl: null,
    seed: true,
    createdAt: now,
  }))
  for (const b of businesses) await f.businesses.replaceOne({ businessId: b.businessId }, b, { upsert: true })

  // Posts: refresh all seeded ones so timestamps stay recent (four today, the rest over the past days).
  await f.posts.deleteMany({ seed: true })
  const users = await db
    .collection<{ userId: string }>('profiles')
    .find({ name: { $exists: true } }, { projection: { userId: 1 } })
    .limit(8)
    .toArray()
  const posts: Post[] = Array.from({ length: 30 }, (_, i) => {
    const isBusiness = i % 2 === 1 || users.length === 0
    const business = businesses[i % businesses.length]!
    const place = isBusiness
      ? (hood(PLACES[i % PLACES.length]!)?.name ?? PLACES[i % PLACES.length]!)
      : PLACES[i % PLACES.length]!
    const hoursAgo = i < 4 ? i + 1 : 20 + i * 6
    const [neighborTitle, neighborCategory] = NEIGHBOR_POSTS[i % NEIGHBOR_POSTS.length]!
    const [businessTitle, quote] = BUSINESS_POSTS[i % BUSINESS_POSTS.length]!
    return {
      townGeoid: WICHITA_GEOID,
      neighborhoodId: hood(place)?.id ?? null,
      place: PLACES[i % PLACES.length]!,
      authorType: isBusiness ? 'business' : 'user',
      authorUserId: isBusiness ? null : users[i % users.length]!.userId,
      businessId: isBusiness ? business.businessId : null,
      title: isBusiness ? businessTitle : neighborTitle,
      quote: isBusiness ? quote : null,
      category: isBusiness ? 'food' : neighborCategory,
      videoUrl: CLIPS[i % CLIPS.length]!,
      thumbnailUrl: null,
      status: 'published',
      seed: true,
      createdAt: new Date(now.getTime() - hoursAgo * 3600_000),
    }
  })
  await f.posts.insertMany(posts)

  await f.events.deleteMany({ seed: true })
  const events: TownEvent[] = [
    ['Farmers market', 2, 9, 'Old Town', 'Family'],
    ['Kids’ story hour', 2, 14, 'Delano', 'Family'],
    ['Riverfront 5K', 3, 7.5, 'Riverside', 'Outdoors'],
    ['Food truck night', 4, 18, 'Midtown', 'Food'],
    ['Porch concert', 5, 19, 'College Hill', 'Events'],
  ].map(([title, days, hour, place, category]) => ({
    townGeoid: WICHITA_GEOID,
    title: title as string,
    startsAt: new Date(today.getTime() + ((days as number) * 24 + (hour as number)) * 3600_000),
    place: place as string,
    category: category as string,
    businessId: null,
    seed: true,
    createdAt: now,
  }))
  await f.events.insertMany(events)

  await f.deals.deleteMany({ seed: true })
  const deals: Deal[] = ['cinnamon rolls', 'iced lattes', 'street tacos'].map((item, i) => ({
    townGeoid: WICHITA_GEOID,
    businessId: businesses[i]!.businessId,
    title: `Deal: 2-for-1 ${item}`,
    startsAt: today,
    endsAt: new Date(today.getTime() + 18 * 3600_000),
    seed: true,
    createdAt: now,
  }))
  await f.deals.insertMany(deals)

  console.log(
    `seeded ${businesses.length} businesses, ${posts.length} posts (${users.length} existing users as authors), ` +
      `${events.length} events, ${deals.length} deals; neighborhoods matched: ${neighborhoods.length}/${PLACES.length}`,
  )
  await client.close()
}

await main()
