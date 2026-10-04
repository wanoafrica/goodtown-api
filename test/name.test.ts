import { describe, expect, it } from 'vitest'
import { normaliseName } from '../src/domain/name'

describe('normaliseName', () => {
  it('trims and collapses spaces', () => expect(normaliseName('  Maria   Lopez ')).toBe('Maria Lopez'))
  it('rejects empty', () => expect(normaliseName('   ')).toBeNull())
  it('rejects digits only', () => expect(normaliseName('12345')).toBeNull())
  it('rejects > 40 chars', () => expect(normaliseName('a'.repeat(41))).toBeNull())
  it('allows accents', () => expect(normaliseName('José')).toBe('José'))
})
