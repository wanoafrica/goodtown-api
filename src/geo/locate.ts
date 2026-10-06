import type { Db } from 'mongodb'
import { geo, type GeoCounty, type GeoNeighborhood, type GeoTown, type Point } from './model'

/** Rural points: the nearest town centre this far away still counts as "your town". */
export const RURAL_SNAP_M = 40_000

export interface Located {
  county: GeoCounty | null
  /** The place whose boundary contains the point, else the nearest town centre within RURAL_SNAP_M. */
  town: GeoTown | null
  /** True when the point is inside the town's boundary (false when snapped to the nearest centre). */
  inTown: boolean
  neighborhood: GeoNeighborhood | null
}

/**
 * The prototype's `geo_locate_point`: county → place → neighborhood by polygon containment.
 * Overlapping places (a CDP inside a city's annexed ring) resolve to the smallest by land area.
 * Outside every Kansas county → `county: null` (the caller treats that as outside the launch area).
 */
export async function locatePoint(db: Db, lng: number, lat: number): Promise<Located> {
  const g = geo(db)
  const point: Point = { type: 'Point', coordinates: [lng, lat] }
  const county = await g.counties.findOne({ geometry: { $geoIntersects: { $geometry: point } } })
  if (!county) return { county: null, town: null, inTown: false, neighborhood: null }

  let town = await g.towns
    .find({ geometry: { $geoIntersects: { $geometry: point } } })
    .sort({ areaM2: 1 })
    .limit(1)
    .next()
  const inTown = !!town
  if (!town) {
    town = await g.towns.findOne({ center: { $near: { $geometry: point, $maxDistance: RURAL_SNAP_M } } })
  }
  const neighborhood =
    inTown && town
      ? await g.neighborhoods.findOne({
          townGeoid: town.geoid,
          active: true,
          geometry: { $geoIntersects: { $geometry: point } },
        })
      : null
  return { county, town, inTown, neighborhood }
}
