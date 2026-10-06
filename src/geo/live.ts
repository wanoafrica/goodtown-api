import type { Db } from 'mongodb'
import { geo, type GeoTown, type LaunchArea, type Point } from './model'
import { haversineM, metresToMiles } from './names'

/**
 * Where Goodtown is open. A point is live when it lies within `radiusM` of a launch town's centre
 * (Wichita, 25 mi at launch — see `launch_areas`). Towns inherit it from their centre point, so a
 * suburb inside the circle (Derby, Andover…) is live and a town outside (Hutchinson) is `not_live`.
 *
 * The launch list is tiny and changes rarely, so it is cached per process for a minute.
 */
export type LaunchTown = LaunchArea & { town: GeoTown }

let cache: { at: number; list: LaunchTown[] } | null = null
const TTL_MS = 60_000

export async function launchTowns(db: Db): Promise<LaunchTown[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.list
  const g = geo(db)
  const areas = await g.launchAreas.find().toArray()
  const towns = await g.towns.find({ geoid: { $in: areas.map((a) => a.townGeoid) } }).toArray()
  const list = areas.flatMap((a) => {
    const town = towns.find((t) => t.geoid === a.townGeoid)
    return town ? [{ ...a, town }] : []
  })
  cache = { at: Date.now(), list }
  return list
}

/** For tests and the loader: forget the cached launch list. */
export function resetLaunchCache() {
  cache = null
}

export function isLivePoint(point: Point, launch: LaunchTown[]): boolean {
  return launch.some((l) => haversineM(point.coordinates, l.town.center.coordinates) <= l.radiusM)
}

export function isLiveTown(town: GeoTown, launch: LaunchTown[]): boolean {
  return isLivePoint(town.center, launch)
}

/** The closest launch town to a point, with the distance in whole miles. */
export function nearestLaunch(point: Point, launch: LaunchTown[]): { town: GeoTown; miles: number } | null {
  let best: { town: GeoTown; m: number } | null = null
  for (const l of launch) {
    const m = haversineM(point.coordinates, l.town.center.coordinates)
    if (!best || m < best.m) best = { town: l.town, m }
  }
  return best ? { town: best.town, miles: metresToMiles(best.m) } : null
}
