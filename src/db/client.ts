import { MongoClient, type Db } from 'mongodb'
import type { Env } from '../env'

/** Single database for every environment (seed, dev, production): `goodtown`. */
export const DB_NAME = 'goodtown'

/**
 * One MongoClient for the process. The driver keeps a connection pool to Atlas
 * and reuses it across requests, which is the normal Node model (and the thing
 * Cloudflare Workers could not do — see git history for the per-request version).
 */
let client: MongoClient | undefined

export function connectMongo(env: Env): MongoClient {
  if (!client) {
    client = new MongoClient(env.MONGODB_URI, {
      maxPoolSize: 20,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 8_000,
      connectTimeoutMS: 8_000,
      appName: 'goodtown-api',
    })
  }
  return client
}

export function getMongo(): MongoClient {
  if (!client) throw new Error('connectMongo(env) must be called at start-up before getMongo()')
  return client
}

/** The `goodtown` database. */
export function getDb(): Db {
  return getMongo().db(DB_NAME)
}

export async function closeMongo(): Promise<void> {
  await client?.close()
  client = undefined
}
