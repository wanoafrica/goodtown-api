/**
 * Loads the Kansas map into MongoDB. Idempotent (upserts by geoid / id). Run: npm run load:kansas
 *
 *   geo_counties       Census TIGER/Line COUNTY, STATEFP 20                       (105 rows)
 *   geo_towns          Census TIGER/Line PLACE for Kansas (cities + CDPs)          (~740 rows)
 *   geo_neighborhoods  City of Wichita "Neighborhood Associations" ArcGIS layer   (~76 rows)
 *   launch_areas       Wichita, 25 mi (only inserted if missing — never overwrites an edited radius)
 *   geo_sources        attribution + counts, for the app's "map sources" screen later
 *
 * Downloads go to a temp dir unless TIGER_CACHE_DIR points at a folder with the zips (kept between runs).
 * Needs network access to www2.census.gov and services5.arcgis.com. ~2 minutes.
 */
import AdmZip from 'adm-zip'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import * as shapefile from 'shapefile'
import { pointOnFeature } from '@turf/point-on-feature'
import { area as turfArea } from '@turf/area'
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon'
import polygonClipping from 'polygon-clipping'
import { DB_NAME } from '../src/db/client'
import {
  DEFAULT_LAUNCH_RADIUS_M,
  WICHITA_GEOID,
  ensureGeoIndexes,
  geo,
  type GeoCounty,
  type GeoNeighborhood,
  type GeoTown,
  type Point,
  type Polygonal,
} from '../src/geo/model'
import { placeKind, wichitaDisplayName } from '../src/geo/names'

const TIGER_YEAR = process.env.TIGER_YEAR ?? '2024'
const TIGER = `https://www2.census.gov/geo/tiger/TIGER${TIGER_YEAR}`
const WICHITA_LAYER =
  'https://services5.arcgis.com/lOHEurd1BgncOSk1/arcgis/rest/services/Wichita_Neighborhood_Associations/FeatureServer/0/query'
const KANSAS_FIPS = '20'

type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: GeoJSON.Geometry }

async function download(url: string, to: string) {
  const cached = process.env.TIGER_CACHE_DIR && join(process.env.TIGER_CACHE_DIR, url.split('/').pop()!)
  if (cached && existsSync(cached)) {
    writeFileSync(to, readFileSync(cached))
    return
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  writeFileSync(to, Buffer.from(await res.arrayBuffer()))
}

/** Reads every feature of the .shp inside a TIGER zip. */
async function readTigerZip(zipPath: string): Promise<Feature[]> {
  const zip = new AdmZip(zipPath)
  const shp = zip.getEntries().find((e) => e.entryName.endsWith('.shp'))
  const dbf = zip.getEntries().find((e) => e.entryName.endsWith('.dbf'))
  if (!shp || !dbf) throw new Error(`no .shp/.dbf in ${zipPath}`)
  const source = await shapefile.open(shp.getData(), dbf.getData(), { encoding: 'latin1' })
  const out: Feature[] = []
  for (;;) {
    const r = await source.read()
    if (r.done) break
    out.push(r.value as Feature)
  }
  return out
}

/**
 * MongoDB's 2dsphere index rejects self-touching rings that shapefiles tolerate. Running the shape
 * through a union with itself normalises it (ring orientation, duplicate points, self-touches).
 */
function normalise(geom: GeoJSON.Geometry): Polygonal {
  const coords = (
    geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : null
  ) as polygonClipping.Geom[] | null
  if (!coords || coords.length === 0) throw new Error(`unsupported geometry ${geom.type}`)
  const [first, ...rest] = coords as [polygonClipping.Geom, ...polygonClipping.Geom[]]
  const unioned = polygonClipping.union(first, ...rest)
  return unioned.length === 1
    ? { type: 'Polygon', coordinates: unioned[0] as number[][][] }
    : { type: 'MultiPolygon', coordinates: unioned as number[][][][] }
}

/**
 * Writes a doc whose `geometry` must pass the 2dsphere index. MongoDB validates on write (ring order,
 * crossing edges, holes that touch the shell…), so we try the normalised geometry first and, if the
 * index still rejects it, the source geometry as published (TIGER polygons are generally valid as-is;
 * Colby 2014650 is the one Kansas place where the union step produces a shape Mongo refuses).
 */
async function upsertGeo<T extends { geometry: Polygonal }>(
  write: (doc: T) => Promise<unknown>,
  doc: T,
  fallbackGeometry: GeoJSON.Geometry,
): Promise<'normalised' | 'source'> {
  try {
    await write(doc)
    return 'normalised'
  } catch (e) {
    if (!/geo keys/i.test((e as Error).message)) throw e
    await write({ ...doc, geometry: fallbackGeometry as Polygonal })
    return 'source'
  }
}

function interiorPoint(geometry: Polygonal, hint?: [number, number]): Point {
  if (hint && booleanPointInPolygon(hint, geometry as never)) return { type: 'Point', coordinates: hint }
  const p = pointOnFeature({ type: 'Feature', properties: {}, geometry: geometry as never })
  return { type: 'Point', coordinates: p.geometry.coordinates as [number, number] }
}

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env')
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is required — set it in .env or the environment')
  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db(DB_NAME)
  const g = geo(db)
  await ensureGeoIndexes(db)
  const tmp = mkdtempSync(join(tmpdir(), 'goodtown-tiger-'))
  const now = new Date()
  const skipped: string[] = []

  try {
    // ---- Counties
    console.log('counties: downloading TIGER', TIGER_YEAR)
    const countyZip = join(tmp, 'county.zip')
    await download(`${TIGER}/COUNTY/tl_${TIGER_YEAR}_us_county.zip`, countyZip)
    const counties = (await readTigerZip(countyZip)).filter((f) => f.properties.STATEFP === KANSAS_FIPS)
    const countyDocs: GeoCounty[] = []
    for (const f of counties) {
      try {
        countyDocs.push({
          geoid: String(f.properties.GEOID),
          name: String(f.properties.NAME),
          geometry: normalise(f.geometry),
          updatedAt: now,
        })
      } catch (e) {
        skipped.push(`county ${f.properties.GEOID}: ${(e as Error).message}`)
      }
    }
    for (const d of countyDocs) {
      const src = counties.find((f) => String(f.properties.GEOID) === d.geoid)!
      await upsertGeo((x) => g.counties.updateOne({ geoid: x.geoid }, { $set: x }, { upsert: true }), d, src.geometry)
    }
    console.log(`counties: ${countyDocs.length}`)

    // ---- Towns (places)
    console.log('towns: downloading')
    const placeZip = join(tmp, 'place.zip')
    await download(`${TIGER}/PLACE/tl_${TIGER_YEAR}_${KANSAS_FIPS}_place.zip`, placeZip)
    const places = await readTigerZip(placeZip)
    console.log(`towns: ${places.length} places in the file`)
    let towns = 0
    for (const f of places) {
      if ((towns + skipped.length) % 100 === 0) console.log(`towns: ${towns} loaded…`)
      const p = f.properties
      if (p.LSAD === '00') continue // "balance of county" pseudo-places (e.g. Greeley County)
      try {
        const geometry = normalise(f.geometry)
        const hint: [number, number] = [Number(p.INTPTLON), Number(p.INTPTLAT)]
        const center = interiorPoint(geometry, hint)
        const county = countyDocs.find((c) => booleanPointInPolygon(center.coordinates, c.geometry as never)) ?? null
        const doc: GeoTown = {
          geoid: String(p.GEOID),
          name: String(p.NAME),
          kind: placeKind(String(p.LSAD)),
          countyGeoid: county?.geoid ?? null,
          countyName: county?.name ?? null,
          geometry,
          center,
          areaM2:
            Number(p.ALAND) || Math.round(turfArea({ type: 'Feature', properties: {}, geometry: geometry as never })),
          updatedAt: now,
        }
        const used = await upsertGeo(
          (d) => g.towns.updateOne({ geoid: d.geoid }, { $set: d }, { upsert: true }),
          doc,
          f.geometry,
        )
        if (used === 'source')
          console.log(
            `towns: ${doc.geoid} ${doc.name} stored with its source geometry (normalised shape rejected by the index)`,
          )
        towns++
      } catch (e) {
        skipped.push(`place ${p.GEOID} ${p.NAME}: ${(e as Error).message}`)
      }
    }
    console.log(`towns: ${towns}`)

    // ---- Wichita neighborhoods
    console.log('neighborhoods: downloading Wichita layer')
    const url = `${WICHITA_LAYER}?where=1%3D1&outFields=*&outSR=4326&f=geojson`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Wichita layer → ${res.status}`)
    const fc = (await res.json()) as { features: Feature[] }
    if (fc.features.length < 50)
      throw new Error(`Wichita layer returned only ${fc.features.length} features; refusing to load`)
    const nameField = ['NAME', 'Name', 'NEIGHBORHOOD', 'Neighborhood', 'ASSOCIATION', 'NA_NAME'].find(
      (k) => k in (fc.features[0]?.properties ?? {}),
    )
    if (!nameField)
      throw new Error(`Wichita layer: no name field in ${Object.keys(fc.features[0]?.properties ?? {}).join(', ')}`)
    let hoods = 0
    const seen = new Set<string>()
    for (const f of fc.features) {
      const official = String(f.properties[nameField] ?? '').trim()
      if (!official) continue
      try {
        const geometry = normalise(f.geometry)
        const sourceId = official.toUpperCase()
        const doc: GeoNeighborhood = {
          id: `wichita_city:${sourceId}`,
          source: 'wichita_city',
          sourceId,
          name: wichitaDisplayName(official),
          officialName: official,
          kind: 'neighborhood',
          townGeoid: WICHITA_GEOID,
          geometry,
          center: interiorPoint(geometry),
          active: true,
          updatedAt: now,
        }
        await upsertGeo((d) => g.neighborhoods.updateOne({ id: d.id }, { $set: d }, { upsert: true }), doc, f.geometry)
        seen.add(doc.id)
        hoods++
      } catch (e) {
        skipped.push(`neighborhood ${official}: ${(e as Error).message}`)
      }
    }
    // Neighborhoods that disappeared from the city layer are deactivated, never deleted; Goodtown-drawn ones are untouched.
    await g.neighborhoods.updateMany(
      { source: 'wichita_city', id: { $nin: [...seen] } },
      { $set: { active: false, updatedAt: now } },
    )
    console.log(`neighborhoods: ${hoods}`)

    // ---- Launch area + sources
    await g.launchAreas.updateOne(
      { townGeoid: WICHITA_GEOID },
      { $setOnInsert: { townGeoid: WICHITA_GEOID, radiusM: DEFAULT_LAUNCH_RADIUS_M, openedAt: now } },
      { upsert: true },
    )
    for (const s of [
      {
        source: 'census_tiger',
        title: `US Census Bureau TIGER/Line ${TIGER_YEAR}`,
        license: 'Public domain',
        attribution: 'U.S. Census Bureau',
        version: TIGER_YEAR,
        loadedAt: now,
        rowCount: countyDocs.length + towns,
      },
      {
        source: 'wichita_city',
        title: 'City of Wichita — Neighborhood Associations',
        license: 'Open data (City of Wichita)',
        attribution: 'City of Wichita GIS',
        loadedAt: now,
        rowCount: hoods,
      },
    ]) {
      await g.sources.updateOne({ source: s.source }, { $set: s }, { upsert: true })
    }

    // ---- Checks
    const wichita = await g.towns.findOne({ geoid: WICHITA_GEOID })
    if (!wichita) throw new Error('Wichita (2079000) missing after load')
    const inWichita = await g.towns.findOne({
      geometry: { $geoIntersects: { $geometry: { type: 'Point', coordinates: [-97.3308, 37.6906] } } },
    })
    const inDelano = await g.neighborhoods.findOne({
      geometry: { $geoIntersects: { $geometry: { type: 'Point', coordinates: [-97.3578, 37.6869] } } },
    })
    console.log(
      `check: Old Town point → ${inWichita?.name ?? 'none'} (${inWichita?.geoid}); Delano point → ${inDelano?.name ?? 'none'}`,
    )
    console.log(
      `done. counties ${countyDocs.length}, towns ${towns}, neighborhoods ${hoods}, skipped ${skipped.length}`,
    )
    for (const s of skipped) console.log('  skipped', s)
    if (countyDocs.length !== 105 || towns < 600) throw new Error('row counts look wrong — not a complete Kansas map')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    await client.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
