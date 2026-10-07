import { ApiError } from '../lib/errors'
import type { Db } from 'mongodb'

/**
 * Kansas geography, loaded by `scripts/load-kansas.ts` from Census TIGER/Line and the City of
 * Wichita's neighborhood layer. Identifiers are the real Census GEOIDs (state FIPS 20):
 *   county 5 digits (Sedgwick 20173) · place 7 digits (Wichita 2079000).
 * Geometry is GeoJSON in WGS84 with 2dsphere indexes; `$geoIntersects` answers "which county /
 * town / neighborhood is this point in", `$near` answers "what is closest".
 */

export type Polygonal = { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
export type Point = { type: 'Point'; coordinates: [number, number] }

export interface GeoCounty {
  geoid: string
  name: string
  geometry: Polygonal
  updatedAt: Date
}

export interface GeoTown {
  geoid: string
  name: string
  /** Census LSAD 57 (census-designated place) → community; everything else incorporated → city. */
  kind: 'city' | 'community'
  countyGeoid: string | null
  countyName: string | null
  geometry: Polygonal
  /** A point guaranteed inside the polygon (Census INTPTLAT/LON) — what `$near` sorts by. */
  center: Point
  /** Land area in m² (Census ALAND) — a point in overlapping places goes to the smallest. */
  areaM2: number
  updatedAt: Date
}

export interface GeoNeighborhood {
  /** `<source>:<sourceId>`, stable across reloads. */
  id: string
  source: 'wichita_city' | 'goodtown'
  sourceId: string
  name: string
  officialName: string
  kind: 'neighborhood' | 'district' | 'hamlet'
  townGeoid: string | null
  geometry: Polygonal
  center: Point
  active: boolean
  updatedAt: Date
}

/** Where Goodtown is open: a point is live when it is within `radiusM` of a launch town's centre. */
export interface LaunchArea {
  townGeoid: string
  radiusM: number
  openedAt: Date
}

export interface GeoSource {
  source: string
  title: string
  license: string
  attribution: string
  version?: string
  loadedAt?: Date
  rowCount?: number
}

export function geo(db: Db) {
  return {
    counties: db.collection<GeoCounty>('geo_counties'),
    towns: db.collection<GeoTown>('geo_towns'),
    neighborhoods: db.collection<GeoNeighborhood>('geo_neighborhoods'),
    launchAreas: db.collection<LaunchArea>('launch_areas'),
    sources: db.collection<GeoSource>('geo_sources'),
  }
}

export async function ensureGeoIndexes(db: Db) {
  const g = geo(db)
  await Promise.all([
    g.counties.createIndex({ geoid: 1 }, { unique: true }),
    g.counties.createIndex({ geometry: '2dsphere' }),
    g.towns.createIndex({ geoid: 1 }, { unique: true }),
    g.towns.createIndex({ geometry: '2dsphere' }),
    g.towns.createIndex({ center: '2dsphere' }),
    g.towns.createIndex({ name: 1 }, { collation: { locale: 'en', strength: 2 } }),
    g.neighborhoods.createIndex({ id: 1 }, { unique: true }),
    g.neighborhoods.createIndex({ geometry: '2dsphere' }),
    g.neighborhoods.createIndex({ townGeoid: 1, active: 1, name: 1 }),
    g.launchAreas.createIndex({ townGeoid: 1 }, { unique: true }),
    g.sources.createIndex({ source: 1 }, { unique: true }),
  ])
}

/** Wichita, the first launch town (Census place 2079000), 25 miles. */
/** The town (without its geometry) or a 404 `not_found` — the shared guard for every `:geoid` route. */
export async function requireTown(db: Db, geoid: string, message?: string): Promise<GeoTown> {
  const town = await geo(db).towns.findOne({ geoid }, { projection: { geometry: 0 } })
  if (!town) throw new ApiError(404, 'not_found', message)
  return town
}

export const WICHITA_GEOID = '2079000'
export const DEFAULT_LAUNCH_RADIUS_M = 40_234
