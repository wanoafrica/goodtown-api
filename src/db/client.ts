import { AsyncLocalStorage } from 'node:async_hooks'
import { MongoClient, type Db } from 'mongodb'
import type { Env } from '../env'

/** Single database for every environment (seed, dev, production): `goodtown`. */
export const DB_NAME = 'goodtown'

/**
 * One MongoClient PER REQUEST.
 *
 * On Workers a TCP socket belongs to the request that opened it; a client cached at module
 * level and reused by the next request on the same isolate fails instantly with an uncaught
 * "I/O on behalf of a different request" error (seen in production as Cloudflare error 1101,
 * roughly every other request). So `withDb` opens a client when a request starts, makes it
 * available through AsyncLocalStorage to everything that runs inside the request (routes and
 * the Better Auth adapter), and closes it after the response is sent (`ctx.waitUntil`).
 *
 * Cost: a TLS + auth handshake to Atlas per request (~0.3–1 s). If that shows up in the app,
 * the next step is a Durable Object that owns a long-lived client and serves queries over RPC.
 */
type Scope = { client: MongoClient }
const scope = new AsyncLocalStorage<Scope>()

export async function withDb<T>(env: Env, ctx: ExecutionContext, fn: () => Promise<T>): Promise<T> {
  const client = new MongoClient(env.MONGODB_URI, {
    maxPoolSize: 5,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8_000,
    connectTimeoutMS: 8_000,
  })
  return scope.run({ client }, async () => {
    try {
      return await fn()
    } finally {
      ctx.waitUntil(client.close().catch(() => undefined))
    }
  })
}

/** The current request's client. Only valid inside `withDb`. */
export function getMongo(): MongoClient {
  const s = scope.getStore()
  if (!s) throw new Error('getMongo() called outside of a request scope (withDb)')
  return s.client
}

/** The current request's `goodtown` database. */
export function getDb(): Db {
  return getMongo().db(DB_NAME)
}

/**
 * A `Db` that always resolves to the current request's database. Better Auth keeps a reference
 * to the Db it was configured with for the life of the (module-cached) auth instance, so it gets
 * this proxy instead of a concrete Db.
 */
export const requestDb: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>
    const value = real[prop]
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value
  },
})
