/** Writes the OTP emails to .preview/ so they can be opened in a browser. Run: npm run email:preview */
import { mkdirSync, writeFileSync } from 'node:fs'
import { otpEmail } from '../src/lib/emailTemplates'

mkdirSync('.preview', { recursive: true })
for (const kind of ['signup', 'login'] as const) {
  const m = otpEmail({
    appName: 'Goodtown',
    otp: '482913',
    kind,
    expiresInMinutes: 5,
    supportEmail: 'hello@goodtown.app',
  })
  writeFileSync(`.preview/otp-${kind}.html`, m.html)
  writeFileSync(`.preview/otp-${kind}.txt`, `Subject: ${m.subject}\n\n${m.text}`)
  console.log(`.preview/otp-${kind}.html`)
}
