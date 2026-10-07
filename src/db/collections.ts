import { MongoServerError, type Db, type ObjectId } from 'mongodb'
import { identifierHash } from '../lib/hash'

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

/** "I want Goodtown here" — `geoid` is a Census place GEOID (see src/geo). */
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
    townRequests: db.collection<TownRequest>('townRequests'),
  }
}

/** Idempotent; run at server start (geo indexes live in src/geo/model.ts). */
export async function ensureIndexes(db: Db) {
  const c = collections(db)
  await Promise.all([
    c.profiles.createIndex({ userId: 1 }, { unique: true }),
    c.signupDenials.createIndex({ identifierHash: 1 }, { unique: true }),
    c.townRequests.createIndex({ geoid: 1, userId: 1 }, { unique: true }),
    // Better Auth never deletes expired rows itself; let MongoDB expire sessions and OTP codes.
    db.collection('session').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_ttl' }),
    db.collection('verification').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_ttl' }),
  ])
}

/** Active (not cleared) under-18 refusal for this login identifier, if any. */
export async function isDenied(db: Db, email: string): Promise<boolean> {
  const denial = await collections(db).signupDenials.findOne(
    { identifierHash: await identifierHash(email), clearedAt: { $exists: false } },
    { projection: { _id: 1 } },
  )
  return !!denial
}

/** True for E11000 — a unique index rejected the write (e.g. a concurrent upsert won the race). */
export function isDuplicateKey(err: unknown): boolean {
  return err instanceof MongoServerError && err.code === 11000
}
