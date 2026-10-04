import { describe, expect, it } from 'vitest'
import { otpEmail } from '../src/lib/emailTemplates'

const base = { appName: 'Goodtown', otp: '482913', expiresInMinutes: 5, supportEmail: 'support@example.test' } as const

describe('otpEmail', () => {
  it('puts the code in subject, text and html', () => {
    const m = otpEmail({ ...base, kind: 'login' })
    expect(m.subject).toBe('482913 is your Goodtown code')
    expect(m.text).toContain('482913')
    expect(m.html).toContain('4&#8201;8&#8201;2&#8201;9&#8201;1&#8201;3')
  })
  it('uses different copy for signup and login', () => {
    expect(otpEmail({ ...base, kind: 'signup' }).html).toContain('Welcome to the neighborhood')
    expect(otpEmail({ ...base, kind: 'login' }).html).toContain('Welcome back')
  })
  it('escapes html in inputs', () => {
    const m = otpEmail({ ...base, appName: '<b>x</b>', kind: 'login' })
    expect(m.html).not.toContain('<b>x</b>')
    expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
  it('has no external resources or scripts', () => {
    const m = otpEmail({ ...base, kind: 'signup' })
    expect(m.html).not.toMatch(/<script|src="http|@import|url\(/i)
  })
})
