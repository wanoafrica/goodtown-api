import type { OpeningHours } from './model'

/** Launch towns are all in Kansas (Central time). Per-town zones come with the first town outside it. */
export const TOWN_TIME_ZONE = 'America/Chicago'

function parts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  })
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]))
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!),
  }
}

/** Midnight at the start of `now`'s local day in `timeZone`, as an absolute instant. */
export function startOfLocalDay(now: Date, timeZone = TOWN_TIME_ZONE): Date {
  const p = parts(now, timeZone)
  const elapsedMs = ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 + now.getUTCMilliseconds()
  return new Date(now.getTime() - elapsedMs)
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}

/** Open right now by the weekly hours (local time). No hours → unknown (null). */
export function isOpenNow(hours: OpeningHours[], now: Date, timeZone = TOWN_TIME_ZONE): boolean | null {
  if (hours.length === 0) return null
  const p = parts(now, timeZone)
  const nowMin = p.hour * 60 + p.minute
  return hours.some((h) => h.day === p.weekday && nowMin >= minutes(h.open) && nowMin < minutes(h.close))
}

/** Small stable number from an id, for the apps' letter-avatar and thumbnail placeholder colours. */
export function tone(id: string, modulo: number): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % modulo
}
