/** Writes the OTP emails to .preview/ so they can be opened in a browser. Run: npm run email:preview */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { otpEmail } from '../src/lib/emailTemplates'
import { OTP_MINUTES } from '../src/lib/sendgrid'

// Same values the Worker gets: vars from wrangler.jsonc (comments stripped).
const wrangler = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '')) as {
  vars: { APP_NAME: string; EMAIL_FROM: string; SUPPORT_EMAIL?: string }
}
const { APP_NAME, EMAIL_FROM, SUPPORT_EMAIL } = wrangler.vars

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
