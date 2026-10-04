import type { Profile } from '../db/collections'

/**
 * Flow map "Where to go?" — evaluated after every verified code and on every app launch.
 * The apps switch on `state` and resume at the matching screen.
 */
export type SignupState =
  | { state: 'under_18' }
  | { state: 'needs_profile' }
  | { state: 'suspended' }
  | { state: 'town_step' }
  | { state: 'terms'; termsVersion: string }
  | { state: 'active'; homeTownGeoid: string | null }

export function signupState(
  profile: Profile | null,
  denied: boolean,
  currentTermsVersion: string,
): SignupState {
  if (denied) return { state: 'under_18' }
  if (!profile || !profile.name || !profile.birthdate) return { state: 'needs_profile' }
  if (profile.suspended) return { state: 'suspended' }
  if (!profile.townStepDone) return { state: 'town_step' }
  if (profile.termsVersion !== currentTermsVersion) return { state: 'terms', termsVersion: currentTermsVersion }
  return { state: 'active', homeTownGeoid: profile.homeTownGeoid }
}
