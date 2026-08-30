/**
 * Tee times from ESPN's core API.
 *
 * The scoreboard endpoint strips tee times from rounds that have not been played
 * — an unstarted round arrives as a bare `{ period: 4 }`. ESPN's core API keeps
 * them, with a real ISO timestamp plus the pairing group and starting tee:
 *
 *   GET sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/{event}
 *       /competitions/{event}/competitors/{athlete}/linescores
 *   → { "period": 4, "startTee": 1, "groupNumber": 15, "teeTime": "2026-08-30T17:50Z" }
 *
 * The host is CORS-open, so the browser can read it directly. One request per
 * player, so callers should fetch once between rounds rather than on every poll.
 */

export interface RoundTeeTime {
  period: number
  teeTime: string
  groupNumber: number | null
  startTee: number | null
}

export function teeTimeUrl(espnEventId: string, espnPlayerId: string): string {
  return `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${espnEventId}` +
    `/competitions/${espnEventId}/competitors/${espnPlayerId}/linescores?limit=10`
}

/** Pull one round's tee time out of a core-API linescores payload. */
export function parseTeeTimePayload(data: unknown, round: number): RoundTeeTime | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (data as any)?.items
  if (!Array.isArray(items)) return null
  const entry = items.find((i) => i?.period === round)
  if (!entry || typeof entry.teeTime !== 'string') return null
  return {
    period: round,
    teeTime: entry.teeTime,
    groupNumber: typeof entry.groupNumber === 'number' ? entry.groupNumber : null,
    startTee: typeof entry.startTee === 'number' ? entry.startTee : null,
  }
}

/**
 * Format an ISO timestamp as an Eastern clock time, e.g. "1:50 PM ET".
 * Uses the IANA zone so it stays correct across the DST boundary — unlike the
 * scoreboard's tee-time strings, which are labelled PDT but carry Eastern times.
 */
export function formatTeeTimeET(iso: string): string | null {
  const date = new Date(iso)
  if (isNaN(date.getTime())) return null
  const time = date.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  })
  // Recent ICU versions separate the meridiem with a narrow no-break space;
  // normalise it so the rendered text matches the rest of the app.
  return `${time.replace(/[  ]/g, ' ')} ET`
}

/**
 * Fetch tee times for the given players. Resolves to a map of ESPN player id →
 * formatted tee time; players without one are simply absent. Never throws.
 */
export async function fetchTeeTimes(
  espnEventId: string,
  espnPlayerIds: string[],
  round: number
): Promise<Map<string, string>> {
  const results = await Promise.all(
    espnPlayerIds.map(async (id) => {
      try {
        const res = await fetch(teeTimeUrl(espnEventId, id), { cache: 'no-store' })
        if (!res.ok) return null
        const parsed = parseTeeTimePayload(await res.json(), round)
        if (!parsed) return null
        const formatted = formatTeeTimeET(parsed.teeTime)
        return formatted ? ([id, formatted] as const) : null
      } catch {
        return null
      }
    })
  )
  return new Map(results.filter((r): r is readonly [string, string] => r !== null))
}
