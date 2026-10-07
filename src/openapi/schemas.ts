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
