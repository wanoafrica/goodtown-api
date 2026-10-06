/** Pure helpers shared by the loader and the routes (unit-tested). */

/**
 * City of Wichita neighborhood association names → display names, mirroring the prototype's
 * `wichita_display_name`: drop the association suffixes, title-case the rest.
 * "DELANO NEIGHBORHOOD ASSOCIATION" → "Delano", "OLD TOWN" → "Old Town".
 */
export function wichitaDisplayName(official: string): string {
  let s = official.trim().replace(/\s+/g, ' ')
  s = s.replace(/\b(NEIGHBORHOOD|NEIGHBORHOODS|ASSOCIATION|ASSOC|ASSN|COALITION|COUNCIL|INC|N\.?A)\.?(?=\s|$)/gi, ' ')
  s = s.replace(/\s+/g, ' ').replace(/^[\s\-–,]+|[\s\-–,]+$/g, '')
  return titleCase(s)
}

const SMALL = new Set(['of', 'and', 'the', 'at', 'on', 'in'])
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) =>
      i > 0 && SMALL.has(w)
        ? w
        : w.replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/(['’-])([a-z])/g, (_, p, c) => p + c.toUpperCase()),
    )
    .join(' ')
}

/** Census LSAD code → our two kinds. '57' is a census-designated place (unincorporated community). */
export function placeKind(lsad: string): 'city' | 'community' {
  return lsad === '57' ? 'community' : 'city'
}

/** Escape user text for a prefix regex. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Great-circle distance in metres between [lng, lat] pairs. */
export function haversineM([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export const metresToMiles = (m: number) => Math.round(m / 1609.344)
