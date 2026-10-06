import { z } from 'zod'

/**
 * Runtime configuration, read once from the process environment at start-up
 * (`loadEnv()` in server.ts). Locally the values come from `.env` (git-ignored,
 * see `.env.example`); in production from the host's environment / secrets.
 */
const schema = z.object({
  // required secrets
  MONGODB_URI: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  /** Public base URL of this API, e.g. https://api.goodtown.app — Better Auth needs it for its own links. */
  BETTER_AUTH_URL: z.url(),
  // optional secrets
  SENDGRID_API_KEY: z.string().optional(),
  // plain config with defaults
  APP_NAME: z.string().default('Goodtown'),
  EMAIL_FROM: z.email().default('hello@goodtown.app'),
  /** Optional reply-to / footer address in emails; falls back to EMAIL_FROM when unset. */
  SUPPORT_EMAIL: z.email().optional(),
  TERMS_VERSION: z.string().default('2026-10'),
  LAUNCH_STATE: z.string().default('KS'),
  /** '1' logs OTP codes instead of emailing them (local dev). */
  OTP_DEBUG_LOG: z.string().optional(),
  /** '1' serves /docs and /openapi.json; anything else → 404. */
  DOCS_ENABLED: z.string().optional(),
  /** Comma-separated proxy headers that carry the client IP (rate limiting). */
  TRUSTED_IP_HEADERS: z.string().default('x-forwarded-for'),
  PORT: z.coerce.number().int().positive().default(8080),
})

export type Env = z.infer<typeof schema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment:\n${problems}\nSee .env.example.`)
  }
  return parsed.data
}
