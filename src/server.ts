import { serve, type HttpBindings } from '@hono/node-server'
import { existsSync } from 'node:fs'
import app from './index'
import { closeMongo, connectMongo, getDb } from './db/client'
import { ensureIndexes } from './db/collections'
import { ensureGeoIndexes } from './geo/model'
import { loadEnv } from './env'

// Local development: read `.env` if present (production injects real environment variables).
if (existsSync('.env')) process.loadEnvFile('.env')

const env = loadEnv()
connectMongo(env)

// Fail fast if the database is unreachable, and make sure the indexes exist.
await getDb().command({ ping: 1 })
await Promise.all([ensureIndexes(getDb()), ensureGeoIndexes(getDb())])

/**
 * Behind a reverse proxy the client IP arrives in X-Forwarded-For (what Better Auth's rate limiter
 * reads, see TRUSTED_IP_HEADERS). For direct connections (local dev, no proxy) fill it from the
 * socket so every client still gets its own rate-limit bucket.
 */
function withClientIp(request: Request, bindings: HttpBindings): Request {
  if (request.headers.get('x-forwarded-for')) return request
  const ip = bindings.incoming.socket.remoteAddress
  if (!ip) return request
  const headers = new Headers(request.headers)
  headers.set('x-forwarded-for', ip)
  return new Request(request, { headers })
}

const server = serve(
  {
    // Hono's `c.env` is whatever we pass as the second argument.
    fetch: (request, bindings) => app.fetch(withClientIp(request, bindings as HttpBindings), env),
    port: env.PORT,
    // No hostname → Node listens dual-stack (IPv4 + IPv6), so both 127.0.0.1 and ::1 work
    // (adb reverse / proxies may use either).
  },
  (info) => console.log(`goodtown-api listening on http://${info.address}:${info.port}`),
)

// Graceful shutdown: stop accepting, finish in-flight requests, close the Mongo pool.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`${signal}: shutting down`)
    server.close(async () => {
      await closeMongo()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
