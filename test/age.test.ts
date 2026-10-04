import { describe, expect, it } from 'vitest'
import { ageOn, isAdult, parseBirthdate } from '../src/domain/age'

const today = new Date(Date.UTC(2026, 9, 4)) // 2026-10-04

describe('parseBirthdate', () => {
  it('accepts a real date', () => expect(parseBirthdate('2001-03-04', today)?.toISOString()).toBe('2001-03-04T00:00:00.000Z'))
  it('rejects Feb 30', () => expect(parseBirthdate('2001-02-30', today)).toBeNull())
  it('rejects Feb 29 in a non-leap year', () => expect(parseBirthdate('2001-02-29', today)).toBeNull())
  it('accepts Feb 29 in a leap year', () => expect(parseBirthdate('2000-02-29', today)).not.toBeNull())
  it('rejects month 13', () => expect(parseBirthdate('2001-13-01', today)).toBeNull())
  it('rejects the future', () => expect(parseBirthdate('2027-01-01', today)).toBeNull())
  it('rejects before 1900', () => expect(parseBirthdate('1899-12-31', today)).toBeNull())
  it('rejects bad format', () => expect(parseBirthdate('3/4/2001', today)).toBeNull())
})

describe('age', () => {
  it('turns 18 on the birthday', () => {
    expect(isAdult(parseBirthdate('2008-10-04', today)!, today)).toBe(true)
    expect(isAdult(parseBirthdate('2008-10-05', today)!, today)).toBe(false)
  })
  it('computes age', () => expect(ageOn(parseBirthdate('2001-03-04', today)!, today)).toBe(25))
})
