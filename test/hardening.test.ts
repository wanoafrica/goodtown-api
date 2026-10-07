import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { loadEnv, type Env } from '../src/env'
import { clientIp, withClientIp } from '../src/lib/clientIp'
import { errorResponse } from '../src/lib/errors'
import { rateLimit } from '../src/middleware/rateLimit'

const base = {
  MONGODB_URI: 'mongodb://localhost:27017',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:8080',
  OTP_DEBUG_LOG: '1',
}
const env = (extra: Record<string, string> = {}): Env => loadEnv({ ...base, ...extra })

describe('loadEnv', () => {
  it('requires SENDGRID_API_KEY unless OTP_DEBUG_LOG=1', () => {
    expect(() => loadEnv({ ...base, OTP_DEBUG_LOG: undefined })).toThrow(/SENDGRID_API_KEY/)
    expect(() => loadEnv({ ...base, OTP_DEBUG_LOG: undefined, SENDGRID_API_KEY: 'SG.x' })).not.toThrow()
  })
  it('rejects OTP_DEBUG_LOG=1 in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', SENDGRID_API_KEY: 'SG.x' })).toThrow(/OTP_DEBUG_LOG/)
  })
})

describe('client IP', () => {
  const req = (headers: Record<string, string>) => new Request('http://x/', { headers })

  it('overwrites a client-sent header with the socket address when no proxy is trusted', () => {
    const r = withClientIp(req({ 'x-forwarded-for': '6.6.6.6' }), env(), '10.0.0.1')
    expect(r.headers.get('x-forwarded-for')).toBe('10.0.0.1')
  })
  it('keeps the proxy header when TRUST_PROXY=1', () => {
    const e = env({ TRUST_PROXY: '1', TRUSTED_IP_HEADERS: 'do-connecting-ip' })
    const r = withClientIp(req({ 'do-connecting-ip': '1.2.3.4' }), e, '10.0.0.1')
    expect(clientIp(r.headers, e)).toBe('1.2.3.4')
  })
  it('takes the hop the proxy appended from a chain', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }), env())).toBe('1.2.3.4')
  })
})

describe('rateLimit', () => {
  it('answers 429 rate_limited with Retry-After past the limit, per client IP', async () => {
    const app = new Hono<{ Bindings: Env }>()
    app.onError(errorResponse)
    app.get('/', rateLimit({ windowMs: 60_000, max: 2 }), (c) => c.json({ ok: true }))
    const call = (ip: string) => app.request('/', { headers: { 'x-forwarded-for': ip } }, env())
    expect((await call('1.1.1.1')).status).toBe(200)
    expect((await call('1.1.1.1')).status).toBe(200)
    const limited = await call('1.1.1.1')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/)
    expect(await limited.json()).toMatchObject({ ok: false, code: 'rate_limited' })
    expect((await call('2.2.2.2')).status).toBe(200)
  })
})

describe('errorResponse', () => {
  it('turns malformed JSON into 400 validation, not 500', async () => {
    const app = new Hono()
    app.onError(errorResponse)
    app.post(
      '/',
      validator('json', (v) => v),
      (c) => c.json({ ok: true }),
    )
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ ok: false, code: 'validation' })
  })
})
