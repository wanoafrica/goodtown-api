import type { Db, ObjectId } from 'mongodb'

/** Profile data Goodtown keeps beyond what Better Auth stores on `user`. Keyed by Better Auth user id. */
export interface Profile {
  _id?: ObjectId
  userId: string
  /** Display name, first name is enough. Set at AuthName/AuthBirthday. */
  name?: string
  /** ISO date yyyy-mm-dd. Immutable after complete_signup. Never returned to other users. */
  birthdate?: string
  /** Flow map: `town_step_done`. True once set_home_town was called (even with null). */
  townStepDone: boolean
  homeTownGeoid: string | null
  neighborhoodId: string | null
  /** Version string accepted at the Neighbor promise step. */
  termsVersion: string | null
  termsAcceptedAt: Date | null
  pushTokens: Array<{ token: string; platform: 'android' | 'ios'; updatedAt: Date }>
  suspended: boolean
  createdAt: Date
  updatedAt: Date
}

/** Permanent under-18 refusal. Keyed by a hash of the login identifier, not the email itself. */
export interface SignupDenial {
  _id?: ObjectId
  identifierHash: string
  reason: 'under_18'
  createdAt: Date
  clearedAt?: Date
}

export interface Town {
  _id?: ObjectId
  geoid: string
  name: string
  state: string
  county: string
  isLive: boolean
  /** GeoJSON point [lng, lat] — 2dsphere index. */
  location: { type: 'Point'; coordinates: [number, number] }
  /** Metres from the centre that still count as "in town". */
  radiusM: number
  neighborhoods: Array<{ id: string; name: string }>
}

export interface TownRequest {
  _id?: ObjectId
  geoid: string
  userId: string
  createdAt: Date
}

export function collections(db: Db) {
  return {
    profiles: db.collection<Profile>('profiles'),
    signupDenials: db.collection<SignupDenial>('signupDenials'),
    towns: db.collection<Town>('towns'),
    townRequests: db.collection<TownRequest>('townRequests'),
  }
}

/** Idempotent; run from the seed script or a one-off admin route. */
export async function ensureIndexes(db: Db) {
  const c = collections(db)
  await Promise.all([
    c.profiles.createIndex({ userId: 1 }, { unique: true }),
    c.signupDenials.createIndex({ identifierHash: 1 }, { unique: true }),
    c.towns.createIndex({ geoid: 1 }, { unique: true }),
    c.towns.createIndex({ location: '2dsphere' }),
    c.towns.createIndex({ state: 1, name: 1 }),
    c.townRequests.createIndex({ geoid: 1, userId: 1 }, { unique: true }),
  ])
}
