import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Loads .dev.vars (Wrangler's local-secrets file) into process.env for plain
 * Node scripts, so the seed can reuse the same values as `wrangler dev`.
 * Real environment variables win over the file.
 */
export function loadDevVars(file = '.dev.vars') {
  let text: string
  try {
    text = readFileSync(resolve(process.cwd(), file), 'utf8')
  } catch {
    return
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}
