import type { Env } from '../env'
import { otpEmail, type OtpEmailKind } from './emailTemplates'

/** Minutes a code stays valid — must match `expiresIn` in src/auth.ts (300 s). */
export const OTP_MINUTES = 5

/**
 * Sends the 6-digit code with SendGrid's v3 Mail Send REST API (plain fetch; the
 * Node SDK is a heavy dependency for one call). With OTP_DEBUG_LOG=1 or no API key it logs instead.
 */
export async function sendOtpEmail(env: Env, to: string, otp: string, kind: OtpEmailKind): Promise<void> {
  if (env.OTP_DEBUG_LOG === '1' || !env.SENDGRID_API_KEY) {
    console.log(`[otp:${kind}] ${to} → ${otp}`)
    return
  }
  const mail = otpEmail({
    appName: env.APP_NAME,
    otp,
    kind,
    expiresInMinutes: OTP_MINUTES,
    supportEmail: env.SUPPORT_EMAIL ?? env.EMAIL_FROM,
  })
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: env.EMAIL_FROM, name: env.APP_NAME },
      reply_to: { email: env.SUPPORT_EMAIL ?? env.EMAIL_FROM, name: env.APP_NAME },
      subject: mail.subject,
      // text/plain first, text/html second — SendGrid requires this order.
      content: [
        { type: 'text/plain', value: mail.text },
        { type: 'text/html', value: mail.html },
      ],
      categories: [`otp-${kind}`],
      // OTP mails must not get click/open tracking (rewritten links + pixel hurt deliverability and trust).
      tracking_settings: {
        click_tracking: { enable: false, enable_text: false },
        open_tracking: { enable: false },
      },
      mail_settings: { bypass_list_management: { enable: true } },
    }),
  })
  if (!res.ok) {
    throw new Error(`SendGrid ${res.status}: ${await res.text()}`)
  }
}
