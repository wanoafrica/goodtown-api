import { describe, expect, it } from 'vitest'
import { escapeRegex, haversineM, metresToMiles, placeKind, titleCase, wichitaDisplayName } from '../src/geo/names'
import { isLivePoint, isLiveTown, nearestLaunch, type LaunchTown } from '../src/geo/live'
import type { GeoTown } from '../src/geo/model'

const town = (geoid: string, name: string, lng: number, lat: number): GeoTown => ({
  geoid,
  name,
  kind: 'city',
  countyGeoid: '20173',
  countyName: 'Sedgwick',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [lng, lat],
        [lng + 0.01, lat],
        [lng + 0.01, lat + 0.01],
        [lng, lat],
      ],
    ],
  },
  center: { type: 'Point', coordinates: [lng, lat] },
  areaM2: 1,
  updatedAt: new Date(0),
})
const wichita = town('2079000', 'Wichita', -97.3375, 37.6872)
const launch: LaunchTown[] = [{ townGeoid: '2079000', radiusM: 40_234, openedAt: new Date(0), town: wichita }]

describe('names', () => {
  it('turns Wichita association names into display names', () => {
    expect(wichitaDisplayName('DELANO NEIGHBORHOOD ASSOCIATION')).toBe('Delano')
    expect(wichitaDisplayName('OLD TOWN')).toBe('Old Town')
    expect(wichitaDisplayName('MCADAMS NEIGHBORHOOD ASSOC.')).toBe('Mcadams')
    expect(wichitaDisplayName('HILLTOP - SOUTH CENTRAL COALITION')).toBe('Hilltop - South Central')
  })
  it('title-cases with small words lower', () => {
    expect(titleCase('college hill of the north')).toBe('College Hill of the North')
    expect(titleCase("o'neil")).toBe("O'Neil")
  })
  it('maps LSAD codes', () => {
    expect(placeKind('25')).toBe('city')
    expect(placeKind('57')).toBe('community')
  })
  it('escapes regex metacharacters', () => {
    expect(escapeRegex('St. (John)')).toBe('St\\. \\(John\\)')
  })
  it('measures distance', () => {
    // Wichita → Hutchinson ≈ 65 km
    const m = haversineM([-97.3375, 37.6872], [-97.9298, 38.0608])
    expect(m).toBeGreaterThan(64_000)
    expect(m).toBeLessThan(68_000)
    expect(metresToMiles(m)).toBe(41)
  })
})

describe('launch areas', () => {
  it('a point inside the Wichita circle is live, Hutchinson is not', () => {
    expect(isLivePoint({ type: 'Point', coordinates: [-97.2, 37.75] }, launch)).toBe(true) // Andover-ish
    expect(isLivePoint({ type: 'Point', coordinates: [-97.9298, 38.0608] }, launch)).toBe(false)
  })
  it('towns inherit liveness from their centre', () => {
    expect(isLiveTown(town('2017800', 'Derby', -97.2689, 37.5456), launch)).toBe(true)
    expect(isLiveTown(town('2033625', 'Hutchinson', -97.9298, 38.0608), launch)).toBe(false)
  })
  it('finds the nearest launch town with miles', () => {
    const n = nearestLaunch({ type: 'Point', coordinates: [-97.9298, 38.0608] }, launch)
    expect(n?.town.geoid).toBe('2079000')
    expect(n?.miles).toBe(41)
    expect(nearestLaunch({ type: 'Point', coordinates: [0, 0] }, [])).toBeNull()
  })
})
