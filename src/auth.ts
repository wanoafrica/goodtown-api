import { betterAuth } from 'better-auth'
import { bearer, emailOTP, openAPI } from 'better-auth/plugins'
import { mongodbAdapter } from '@better-auth/mongo-adapter'
import type { Env } from './env'
import { getDb, getMongo } from './db/client'
import { sendOtpEmail } from './lib/sendgrid'

let cached: { key: string; auth: ReturnType<typeof buildAuth> } | undefined

/**
 * Better Auth owns users, sessions and the email OTP table. We add nothing to
 * its schema; Goodtown profile data lives in our own `profiles` collection.
 *
 * Endpoints it exposes under /api/auth (used directly by the apps):
 *   POST /api/auth/email-otp/send-verification-otp  { email, type: "sign-in" }
 *   POST /api/auth/sign-in/email-otp                 { email, otp }  → set-auth-token header
 *   GET  /api/auth/get-session                       (Authorization: Bearer <token>)
 *   POST /api/auth/sign-out
 */
export function createAuth(env: Env) {
  const key = env.MONGODB_URI + '|' + env.BETTER_AUTH_SECRET
  if (cached?.key === key) return cached.auth
  const auth = buildAuth(env)
  cached = { key, auth }
  return auth
}

export type Auth = ReturnType<typeof buildAuth>

function buildAuth(env: Env) {
  return betterAuth({
    appName: env.APP_NAME,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    database: mongodbAdapter(getDb(), { client: getMongo() }),
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 60 * 60 * 24 * 90, // 90 days — phones stay signed in
      updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
    },
    // Behind a reverse proxy the client IP arrives in a header; Better Auth rate-limits per IP.
    advanced: { ipAddress: { ipAddressHeaders: env.TRUSTED_IP_HEADERS.split(',').map((h) => h.trim()) } },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: 3 },
        '/sign-in/email-otp': { window: 60, max: 6 },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== 'sign-in') return
          // Both the log-in and sign-up flows send type "sign-in"; the copy differs by whether the account exists yet.
          const existing = await getDb()
            .collection('user')
            .findOne({ email: email.toLowerCase() }, { projection: { _id: 1 } })
          await sendOtpEmail(env, email, otp, existing ? 'login' : 'signup')
        },
      }),
      bearer(),
      // Only used to pull the OTP/session endpoints into our /openapi.json; the Scalar page it ships is off.
      openAPI({ disableDefaultReference: true }),
    ],
  })
}
