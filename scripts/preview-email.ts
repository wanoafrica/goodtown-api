/** Writes the OTP emails to .preview/ so they can be opened in a browser. Run: npm run email:preview */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { otpEmail } from '../src/lib/emailTemplates'
import { OTP_MINUTES } from '../src/lib/sendgrid'
import { loadEnv } from '../src/env'

// Same values the server gets: .env (if present) + defaults from src/env.ts.
if (existsSync('.env')) process.loadEnvFile('.env')
const { APP_NAME, EMAIL_FROM, SUPPORT_EMAIL } = loadEnv({
  ...process.env,
  MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://preview',
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'preview-only-secret-preview-only-secret',
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:8080',
})

mkdirSync('.preview', { recursive: true })
for (const kind of ['signup', 'login'] as const) {
  const m = otpEmail({
    appName: APP_NAME,
    otp: '482913',
    kind,
    expiresInMinutes: OTP_MINUTES,
    supportEmail: SUPPORT_EMAIL ?? EMAIL_FROM,
  })
  writeFileSync(`.preview/otp-${kind}.html`, m.html)
  writeFileSync(`.preview/otp-${kind}.txt`, `Subject: ${m.subject}\n\n${m.text}`)
  console.log(`.preview/otp-${kind}.html`)
}
