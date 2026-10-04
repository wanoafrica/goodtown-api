/**
 * Seeds the Kansas launch-area towns and creates indexes.
 * Run: npm run seed:towns   (reads MONGODB_URI from .dev.vars or the environment; idempotent — upserts by geoid)
 */
import { MongoClient } from 'mongodb'
import { loadDevVars } from './load-dev-vars'
import { collections, ensureIndexes, type Town } from '../src/db/collections'
import { DB_NAME } from '../src/db/client'

const towns: Town[] = [
  {
    geoid: 'ks-wichita', name: 'Wichita', state: 'KS', county: 'Sedgwick County', isLive: true,
    location: { type: 'Point', coordinates: [-97.3301, 37.6872] }, radiusM: 20_000,
    neighborhoods: [
      { id: 'old-town', name: 'Old Town' }, { id: 'delano', name: 'Delano' }, { id: 'college-hill', name: 'College Hill' },
      { id: 'riverside', name: 'Riverside' }, { id: 'downtown', name: 'Downtown' }, { id: 'midtown', name: 'Midtown' },
    ],
  },
  { geoid: 'ks-derby', name: 'Derby', state: 'KS', county: 'Sedgwick County', isLive: false, location: { type: 'Point', coordinates: [-97.2689, 37.5456] }, radiusM: 8_000, neighborhoods: [] },
  { geoid: 'ks-winfield', name: 'Winfield', state: 'KS', county: 'Cowley County', isLive: false, location: { type: 'Point', coordinates: [-96.9956, 37.2398] }, radiusM: 8_000, neighborhoods: [] },
  { geoid: 'ks-wellington', name: 'Wellington', state: 'KS', county: 'Sumner County', isLive: false, location: { type: 'Point', coordinates: [-97.3717, 37.2653] }, radiusM: 6_000, neighborhoods: [] },
  { geoid: 'ks-wilson', name: 'Wilson', state: 'KS', county: 'Ellsworth County', isLive: false, location: { type: 'Point', coordinates: [-98.4745, 38.8242] }, radiusM: 4_000, neighborhoods: [] },
  { geoid: 'ks-hutchinson', name: 'Hutchinson', state: 'KS', county: 'Reno County', isLive: false, location: { type: 'Point', coordinates: [-97.9298, 38.0608] }, radiusM: 10_000, neighborhoods: [] },
  { geoid: 'ks-salina', name: 'Salina', state: 'KS', county: 'Saline County', isLive: false, location: { type: 'Point', coordinates: [-97.6114, 38.8403] }, radiusM: 10_000, neighborhoods: [] },
  { geoid: 'ks-topeka', name: 'Topeka', state: 'KS', county: 'Shawnee County', isLive: false, location: { type: 'Point', coordinates: [-95.6890, 39.0473] }, radiusM: 15_000, neighborhoods: [] },
  { geoid: 'ks-lawrence', name: 'Lawrence', state: 'KS', county: 'Douglas County', isLive: false, location: { type: 'Point', coordinates: [-95.2353, 38.9717] }, radiusM: 10_000, neighborhoods: [] },
  { geoid: 'ks-manhattan', name: 'Manhattan', state: 'KS', county: 'Riley County', isLive: false, location: { type: 'Point', coordinates: [-96.5717, 39.1836] }, radiusM: 10_000, neighborhoods: [] },
  { geoid: 'ks-overland-park', name: 'Overland Park', state: 'KS', county: 'Johnson County', isLive: false, location: { type: 'Point', coordinates: [-94.6708, 38.9822] }, radiusM: 15_000, neighborhoods: [] },
]

async function main() {
  loadDevVars()
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is required — set it in .dev.vars or the environment')
  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db(DB_NAME)
  await ensureIndexes(db)
  const { towns: col } = collections(db)
  for (const t of towns) {
    await col.updateOne({ geoid: t.geoid }, { $set: t }, { upsert: true })
  }
  console.log(`Seeded ${towns.length} towns into ${db.databaseName}`)
  await client.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
