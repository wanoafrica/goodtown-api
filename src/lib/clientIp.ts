import type { Env } from '../env'

/** The configured client-IP headers (TRUSTED_IP_HEADERS), lower-cased. */
export function ipHeaders(env: Env): string[] {
  return env.TRUSTED_IP_HEADERS.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Makes the client-IP headers trustworthy before anything reads them (Better Auth's rate limiter,
 * our own `rateLimit`). Unless TRUST_PROXY=1 says a reverse proxy in front sets them, a client could
 * send any value and get a fresh rate-limit bucket per request — so they are overwritten with the
 * socket address. Behind a trusted proxy (DigitalOcean: `do-connecting-ip`) the request is left as is.
 */
export function withClientIp(request: Request, env: Env, socketIp: string | undefined): Request {
  if (env.TRUST_PROXY === '1' || !socketIp) return request
  const headers = new Headers(request.headers)
  for (const name of ipHeaders(env)) headers.set(name, socketIp)
  return new Request(request, { headers })
}

/** Client IP for rate limiting: the first configured header present; for a chain, the hop the proxy saw. */
export function clientIp(headers: Headers, env: Env): string {
  for (const name of ipHeaders(env)) {
    const value = headers.get(name)
    if (!value) continue
    const hops = value
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
    if (hops.length) return hops[hops.length - 1]!
  }
  return 'unknown'
}
