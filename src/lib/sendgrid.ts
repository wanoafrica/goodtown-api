import type { Env } from '../env'

/** Sends the 6-digit code. With OTP_DEBUG_LOG=1 (local dev) it logs instead. */
export async function sendOtpEmail(env: Env, to: string, otp: string): Promise<void> {
  if (env.OTP_DEBUG_LOG === '1' || !env.SENDGRID_API_KEY) {
    console.log(`[otp] ${to} → ${otp}`)
    return
  }
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: env.EMAIL_FROM, name: env.APP_NAME },
      subject: `${otp} is your ${env.APP_NAME} code`,
      content: [
        {
          type: 'text/plain',
          value:
            `Your ${env.APP_NAME} code is ${otp}. It works for 5 minutes.\n\n` +
            `If you didn't ask for it, you can ignore this email.`,
        },
      ],
    }),
  })
  if (!res.ok) {
    throw new Error(`SendGrid ${res.status}: ${await res.text()}`)
  }
}
