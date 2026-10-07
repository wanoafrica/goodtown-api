import { createMiddleware } from 'hono/factory'
import type { Env } from '../env'
import { ApiError } from '../lib/errors'
import { clientIp } from '../lib/clientIp'

/**
 * Fixed-window, per-client-IP limiter for our own public routes (Better Auth limits its endpoints
 * itself). In-memory, so it is per process — fine while the app runs as one instance (`.do/app.yaml`
 * `instance_count: 1`); move the counters to MongoDB before scaling out.
 */
export function rateLimit(opts: { windowMs: number; max: number; maxKeys?: number }) {
  const maxKeys = opts.maxKeys ?? 10_000
  const hits = new Map<string, { count: number; resetAt: number }>()
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const now = Date.now()
    const key = clientIp(c.req.raw.headers, c.env)
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      if (!entry && hits.size >= maxKeys) {
        // Drop expired windows first; if every window is live, evict the oldest key.
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value!)
      }
      entry = { count: 0, resetAt: now + opts.windowMs }
      hits.set(key, entry)
    }
    entry.count++
    if (entry.count > opts.max) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      throw new ApiError(429, 'rate_limited', 'Too many requests')
    }
    await next()
  })
}
