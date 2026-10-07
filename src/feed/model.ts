import type { Db, ObjectId } from 'mongodb'
import type { Point } from '../geo/model'

/**
 * Town feed content (Figma Main 5:628, Player 5:2408). Everything is scoped to a town (Census GEOID).
 * Videos are uploaded elsewhere (Upload screen, not built yet); a post only stores the playable URL.
 */

export const FEED_CATEGORIES = ['food', 'events', 'family', 'outdoors', 'shops', 'sports'] as const
export type FeedCategory = (typeof FEED_CATEGORIES)[number]

export const REACTIONS = ['want_to_go', 'love', 'been_there', 'save', 'thanks'] as const
export type Reaction = (typeof REACTIONS)[number]

/** Opening hours in the town's local time. `day` 0 = Sunday. "HH:MM", close may be "24:00". */
export interface OpeningHours {
  day: number
  open: string
  close: string
}

export interface Business {
  _id?: ObjectId
  /** Stable public id ("b_…"). */
  businessId: string
  name: string
  townGeoid: string
  neighborhoodId: string | null
  location: Point | null
  isVerified: boolean
  hours: OpeningHours[]
  thumbnailUrl: string | null
  /** Set by scripts/seed-feed.ts so demo content can be removed again. */
  seed?: boolean
  createdAt: Date
}

export interface Post {
  _id?: ObjectId
  townGeoid: string
  neighborhoodId: string | null
  /** Neighborhood display name, denormalised for the feed ("Delano"). */
  place: string
  /** A person posts as themselves, or a business posts as the business. */
  authorType: 'user' | 'business'
  authorUserId: string | null
  businessId: string | null
  title: string
  /** Optional on-video quote chip. */
  quote: string | null
  category: FeedCategory | null
  videoUrl: string
  thumbnailUrl: string | null
  /** Only `published` posts are shown; `held` waits for review (HeldPosts 5:1856). */
  status: 'published' | 'held' | 'removed'
  seed?: boolean
  createdAt: Date
}

export interface TownEvent {
  _id?: ObjectId
  townGeoid: string
  title: string
  startsAt: Date
  place: string
  /** Display label, e.g. "Family"; matched case-insensitively against a feed category. */
  category: string
  businessId: string | null
  seed?: boolean
  createdAt: Date
}

export interface Deal {
  _id?: ObjectId
  townGeoid: string
  businessId: string
  title: string
  startsAt: Date
  endsAt: Date
  seed?: boolean
  createdAt: Date
}

export interface PostReaction {
  _id?: ObjectId
  postId: string
  userId: string
  reaction: Reaction
  createdAt: Date
}

export interface EventSave {
  _id?: ObjectId
  eventId: string
  userId: string
  createdAt: Date
}

export function feedCollections(db: Db) {
  return {
    businesses: db.collection<Business>('businesses'),
    posts: db.collection<Post>('posts'),
    events: db.collection<TownEvent>('events'),
    deals: db.collection<Deal>('deals'),
    reactions: db.collection<PostReaction>('postReactions'),
    eventSaves: db.collection<EventSave>('eventSaves'),
  }
}

/** Idempotent; run at server start. */
export async function ensureFeedIndexes(db: Db) {
  const f = feedCollections(db)
  await Promise.all([
    f.businesses.createIndex({ businessId: 1 }, { unique: true }),
    // Feed order (newest first, `_id` breaks ties) within a town, with and without a category.
    f.posts.createIndex({ townGeoid: 1, status: 1, createdAt: -1, _id: -1 }),
    f.posts.createIndex({ townGeoid: 1, status: 1, category: 1, createdAt: -1, _id: -1 }),
    f.events.createIndex({ townGeoid: 1, startsAt: 1 }),
    f.deals.createIndex({ townGeoid: 1, endsAt: 1 }),
    f.reactions.createIndex({ postId: 1, userId: 1, reaction: 1 }, { unique: true }),
    f.reactions.createIndex({ userId: 1, postId: 1 }),
    f.eventSaves.createIndex({ eventId: 1, userId: 1 }, { unique: true }),
  ])
}
