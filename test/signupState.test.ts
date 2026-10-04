import { describe, expect, it } from 'vitest'
import { signupState } from '../src/domain/signupState'
import type { Profile } from '../src/db/collections'

const base: Profile = {
  userId: 'u1', name: 'Maria', birthdate: '2001-03-04', townStepDone: true, homeTownGeoid: 'ks-wichita',
  neighborhoodId: null, termsVersion: '2026-10', termsAcceptedAt: new Date(), pushTokens: [], suspended: false,
  createdAt: new Date(), updatedAt: new Date(),
}

describe('signupState (flow map "Where to go?")', () => {
  it('under 18 wins over everything', () => expect(signupState(base, true, '2026-10').state).toBe('under_18'))
  it('no profile → needs_profile', () => expect(signupState(null, false, '2026-10').state).toBe('needs_profile'))
  it('suspended', () => expect(signupState({ ...base, suspended: true }, false, '2026-10').state).toBe('suspended'))
  it('town step pending', () => expect(signupState({ ...base, townStepDone: false }, false, '2026-10').state).toBe('town_step'))
  it('terms outdated', () => expect(signupState({ ...base, termsVersion: '2026-01' }, false, '2026-10').state).toBe('terms'))
  it('active', () => expect(signupState(base, false, '2026-10')).toEqual({ state: 'active', homeTownGeoid: 'ks-wichita' }))
})
