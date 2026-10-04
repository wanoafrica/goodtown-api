import { MongoClient, type Db } from 'mongodb'
import type { Env } from '../env'

/**
 * One MongoClient per Worker isolate. Isolates stay warm between requests on
 * the same edge node, so most requests reuse the connection; a cold isolate
 * pays one TLS handshake. If latency matters later, move this behind a
 * Durable Object so the connection lives longer.
 */
let client: MongoClient | undefined
let clientUri: string | undefined

export function getMongo(env: Env): MongoClient {
  if (!client || clientUri !== env.MONGODB_URI) {
    client = new MongoClient(env.MONGODB_URI, {
      maxPoolSize: 5,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 8_000,
    })
    clientUri = env.MONGODB_URI
  }
  return client
}

/** Single database for every environment (seed, dev, production): `goodtown`. */
export const DB_NAME = 'goodtown'

export function getDb(env: Env): Db {
  return getMongo(env).db(DB_NAME)
}
