/** Pure date rules shared by the API (and documented for the apps). */

export const MIN_AGE = 18
export const MIN_YEAR = 1900

/** Parses yyyy-mm-dd strictly: the calendar date must exist, be ≥ 1900 and not in the future. */
export function parseBirthdate(input: string, today = new Date()): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  const exists = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
  if (!exists || y < MIN_YEAR) return null
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  return date > todayUtc ? null : date
}

export function ageOn(birthdate: Date, today = new Date()): number {
  let age = today.getUTCFullYear() - birthdate.getUTCFullYear()
  const hadBirthday =
    today.getUTCMonth() > birthdate.getUTCMonth() ||
    (today.getUTCMonth() === birthdate.getUTCMonth() && today.getUTCDate() >= birthdate.getUTCDate())
  if (!hadBirthday) age -= 1
  return age
}

export function isAdult(birthdate: Date, today = new Date()): boolean {
  return ageOn(birthdate, today) >= MIN_AGE
}
