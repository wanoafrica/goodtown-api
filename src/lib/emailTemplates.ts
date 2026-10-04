/**
 * Transactional email templates. Pure functions → { subject, text, html } so they
 * can be unit-tested and previewed (`npm run email:preview`) without SendGrid.
 *
 * Email HTML rules followed here: table layout, inline styles, no external CSS or
 * JS, system/web-safe font stacks with Fraunces/DM Sans listed first for clients
 * that have them (Apple Mail), max 600px fluid, dark-mode hint via color-scheme.
 * Colours are the Goodtown palette (config.md §Colours).
 */

export type OtpEmailKind = 'signup' | 'login'

export type OtpEmailInput = {
  appName: string
  otp: string
  kind: OtpEmailKind
  /** Minutes the code stays valid. */
  expiresInMinutes: number
  /** Shown in the footer as the support address. */
  supportEmail: string
}

const palette = {
  cream: '#FBF6EA',
  green: '#1F4D3A',
  greenPanel: '#2A5A46',
  gold: '#F2B61B',
  goldTint: '#FFF4D1',
  ink: '#1C1B17',
  body: '#3D3C35',
  muted: '#5E5C52',
  line: '#E2D8C0',
  cardBorder: '#EDE4CF',
  white: '#FFFFFF',
}

const serif = `Fraunces, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`
const sans = `'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`

const copy: Record<OtpEmailKind, { preheader: string; eyebrow: string; title: string; lead: string }> = {
  signup: {
    preheader: 'Your code to finish creating your account.',
    eyebrow: 'Welcome to the neighborhood',
    title: 'Confirm your email',
    lead: 'Enter this code in the app to keep going with your new account.',
  },
  login: {
    preheader: 'Your code to log back in.',
    eyebrow: 'Welcome back',
    title: 'Here’s your log-in code',
    lead: 'Enter this code in the app to log in.',
  },
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
}

export function otpEmail(input: OtpEmailInput): { subject: string; text: string; html: string } {
  const c = copy[input.kind]
  const app = escapeHtml(input.appName)
  const otp = escapeHtml(input.otp)
  const minutes = input.expiresInMinutes
  const support = escapeHtml(input.supportEmail)
  // Digits spaced out so screen readers read them one by one and they are easy to copy.
  const spacedOtp = otp.split('').join('&#8201;')

  const subject = `${input.otp} is your ${input.appName} code`

  const text =
    `${c.eyebrow}\n\n${c.lead}\n\n` +
    `Your code: ${input.otp}\n\n` +
    `It works for ${minutes} minutes and only in the ${input.appName} app. ` +
    `${input.appName} will never ask you for this code by email, text or phone.\n\n` +
    `Didn’t request this? You can ignore this email — nothing happens without the code.\n\n` +
    `— ${input.appName}\n${input.supportEmail}`

  const html = `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${subject}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  :root { color-scheme: light; supported-color-schemes: light; }
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
  img { border:0; line-height:100%; outline:none; text-decoration:none; }
  a { color:${palette.green}; }
  @media screen and (max-width: 600px) {
    .gt-shell { padding: 16px 12px 24px !important; }
    .gt-card  { border-radius: 20px !important; }
    .gt-pad   { padding-left: 24px !important; padding-right: 24px !important; }
    .gt-title { font-size: 26px !important; line-height: 32px !important; }
    .gt-code  { font-size: 36px !important; letter-spacing: 8px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${palette.cream};">
<!-- preheader -->
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(c.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${palette.cream};">
  <tr>
    <td align="center" class="gt-shell" style="padding:40px 16px 48px;">
      <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

        <!-- wordmark -->
        <tr>
          <td align="center" style="padding:0 0 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle" style="padding-right:10px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr><td style="width:14px;height:14px;border-radius:7px;background:${palette.gold};font-size:0;line-height:0;">&nbsp;</td></tr>
                  </table>
                </td>
                <td valign="middle" style="font-family:${serif};font-size:22px;line-height:24px;font-weight:600;color:${palette.green};letter-spacing:-0.2px;">${app}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- card -->
        <tr>
          <td class="gt-card" style="background:${palette.white};border:1px solid ${palette.cardBorder};border-radius:24px;overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <!-- green header band -->
              <tr>
                <td class="gt-pad" style="background:${palette.green};padding:28px 40px 26px;">
                  <div style="font-family:${sans};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${palette.gold};">${escapeHtml(c.eyebrow)}</div>
                  <div class="gt-title" style="font-family:${serif};font-size:30px;line-height:36px;font-weight:600;color:${palette.white};padding-top:8px;letter-spacing:-0.3px;">${escapeHtml(c.title)}</div>
                </td>
              </tr>
              <!-- body -->
              <tr>
                <td class="gt-pad" style="padding:32px 40px 8px;">
                  <p style="margin:0;font-family:${sans};font-size:16px;line-height:24px;color:${palette.body};">${escapeHtml(c.lead)}</p>
                </td>
              </tr>
              <!-- code -->
              <tr>
                <td class="gt-pad" style="padding:20px 40px 8px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" style="background:${palette.goldTint};border:1px solid ${palette.line};border-radius:16px;padding:26px 16px;">
                        <div class="gt-code" aria-label="Your code is ${otp}" style="font-family:${serif};font-size:44px;line-height:52px;font-weight:600;letter-spacing:10px;color:${palette.ink};font-variant-numeric:tabular-nums;">${spacedOtp}</div>
                        <div style="font-family:${sans};font-size:13px;line-height:18px;color:${palette.muted};padding-top:8px;">Works for ${minutes} minutes</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- safety -->
              <tr>
                <td class="gt-pad" style="padding:20px 40px 36px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="border-top:1px solid ${palette.cardBorder};padding-top:20px;">
                        <p style="margin:0 0 10px;font-family:${sans};font-size:14px;line-height:21px;color:${palette.muted};">
                          Only enter this code in the ${app} app. ${app} will never ask you for it by email, text or phone.
                        </p>
                        <p style="margin:0;font-family:${sans};font-size:14px;line-height:21px;color:${palette.muted};">
                          Didn’t request this? You can ignore this email — nothing happens without the code.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- footer -->
        <tr>
          <td align="center" style="padding:24px 24px 0;">
            <p style="margin:0;font-family:${sans};font-size:12px;line-height:18px;color:${palette.muted};">
              Sent by ${app} because this address was entered in the app.<br>
              Questions? <a href="mailto:${support}" style="color:${palette.green};text-decoration:underline;">${support}</a>
            </p>
          </td>
        </tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`

  return { subject, text, html }
}
