import { z } from 'zod'
import { ERROR_CODES } from '../lib/errors'

/** Zod schemas used only to describe responses in the OpenAPI document. Keep in step with docs/api.md. */

export const okSchema = z.object({ ok: z.literal(true) })

export const errorSchema = z.object({
  ok: z.literal(false),
  code: z.enum(ERROR_CODES),
  message: z.string().optional(),
  details: z.unknown().optional(),
})

export const townSchema = z.object({
  geoid: z.string().describe('Census place GEOID, e.g. Wichita 2079000'),
  name: z.string(),
  kind: z.enum(['city', 'community']).describe('city = incorporated place; community = census-designated place'),
  state: z.string(),
  county: z.string().describe('Display form, e.g. "Sedgwick County"'),
  isLive: z.boolean().describe('Inside a launch area (Wichita, 25 mi)'),
})

export const neighborhoodSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const emailCheckResponse = z.object({
  ok: z.literal(true),
  exists: z.boolean(),
})

export const authStateResponse = z.object({
  ok: z.literal(true),
  state: z.enum(['under_18', 'needs_profile', 'suspended', 'town_step', 'terms', 'active']),
  termsVersion: z.string().optional().describe('Present when state = terms'),
  homeTownGeoid: z.string().nullable().optional().describe('Present when state = active'),
  profile: z
    .object({
      name: z.string().nullable(),
      homeTownGeoid: z.string().nullable(),
      neighborhoodId: z.string().nullable(),
    })
    .nullable(),
})

export const resolveResponse = z.union([
  z.object({
    ok: z.literal(true),
    resolution: z.enum(['live', 'not_live']),
    town: townSchema,
    neighborhood: neighborhoodSchema
      .nullable()
      .describe('The neighborhood the point falls in, when the town has a layer'),
  }),
  z.object({
    ok: z.literal(true),
    resolution: z.literal('outside_launch_area'),
  }),
])

export const searchResponse = z.object({
  ok: z.literal(true),
  towns: z.array(townSchema),
})

export const neighborhoodsResponse = z.object({
  ok: z.literal(true),
  neighborhoods: z.array(neighborhoodSchema),
})

export const interestResponse = z.object({
  ok: z.literal(true),
  wantCount: z.number().int(),
  alreadyRequested: z.boolean(),
  nearestLive: townSchema.nullable(),
  nearestLiveMiles: z.number().int().nullable(),
})

export const requestResponse = z.object({
  ok: z.literal(true),
  wantCount: z.number().int(),
  alreadyRequested: z.literal(true),
})

// MARK: - Town feed (Figma Main 5:628, Player 5:2408)

const authorSchema = z.object({
  id: z.string(),
  name: z.string(),
  isBusiness: z.boolean(),
  isVerified: z.boolean(),
  avatarTone: z.number().int().describe('0–4: which letter-avatar colour the apps use'),
})

const feedBusinessSchema = z.object({
  id: z.string(),
  name: z.string(),
  isVerified: z.boolean(),
  isOpenNow: z.boolean().nullable().describe('null when the business has no opening hours'),
  distanceMiles: z.number().nullable().describe("From the viewer's home neighborhood (or town) centre"),
  dealId: z.string().nullable().describe('A live deal → "Get deal"'),
  thumbnailUrl: z.string().nullable(),
  thumbnailTone: z.number().int(),
})

export const reactionEnum = z.enum(['want_to_go', 'love', 'been_there', 'save', 'thanks'])

export const feedItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('video'),
    id: z.string(),
    author: authorSchema,
    title: z.string(),
    quote: z.string().nullable(),
    place: z.string().describe('Neighborhood name'),
    postedAt: z.string().describe('ISO 8601'),
    isNew: z.boolean().describe('Posted since the viewer’s previous visit'),
    videoUrl: z.string(),
    thumbnailUrl: z.string().nullable(),
    thumbnailTone: z.number().int(),
    business: feedBusinessSchema.nullable(),
    myReactions: z.array(reactionEnum),
  }),
  z.object({
    type: z.literal('event'),
    id: z.string(),
    title: z.string(),
    startsAt: z.string(),
    place: z.string(),
    category: z.string(),
    saved: z.boolean(),
  }),
  z.object({
    type: z.literal('deal'),
    id: z.string(),
    title: z.string(),
    businessName: z.string(),
    endsAt: z.string(),
  }),
  z.object({ type: z.literal('caught_up').describe('"That’s everything new today"; older posts follow') }),
])

export const feedResponse = z.object({
  ok: z.literal(true),
  items: z.array(feedItemSchema),
  nextCursor: z.string().nullable().describe('Pass back as `cursor`; null = end of the feed'),
})

export const townHomeResponse = z.object({
  ok: z.literal(true),
  town: z.object({ geoid: z.string(), name: z.string() }),
  firstName: z.string().nullable(),
  newSinceLastVisit: z.number().int(),
  todayNote: z.string().nullable().describe('e.g. "72° sunny · outdoor picks first"; null hides the line'),
  today: z.object({ videos: z.number().int(), events: z.number().int(), deals: z.number().int() }),
  neighborsPostingToday: z.array(z.object({ id: z.string(), name: z.string(), avatarTone: z.number().int() })),
})

export const toggleResponse = z.object({ ok: z.literal(true), active: z.boolean() })

// MARK: - Explore (Figma 5:26)

export const exploreResponse = z.object({
  ok: z.literal(true),
  town: z.object({ geoid: z.string(), name: z.string() }),
  localVoices: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        topic: z.string().nullable().describe('Their usual neighborhood + category, e.g. "Delano food"'),
        avatarTone: z.number().int(),
      }),
    )
    .describe('Neighbors who posted most in the last 30 days'),
  original: z
    .object({
      id: z.string(),
      title: z.string(),
      place: z.string(),
      minutes: z.number().int(),
      videoUrl: z.string().nullable(),
    })
    .nullable()
    .describe('Newest Goodtown Original; null hides the card'),
  neighborhoods: z.array(neighborhoodSchema).describe('Busiest in the last 30 days, else A–Z'),
})
