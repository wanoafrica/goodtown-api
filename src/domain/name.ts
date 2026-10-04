export const NAME_MAX_LENGTH = 40

/** Server-side name rule: 1–40 chars after trimming, at least one letter. Profanity filtering is a later concern. */
export function normaliseName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, ' ')
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) return null
  if (!/\p{L}/u.test(name)) return null
  return name
}
