/**
 * ESPN Golf ingestion helpers — server-side only.
 *
 * The leaderboard endpoint (site.web.api.espn.com) requires internal ESPN
 * network access and returns 404 publicly. All data comes from the scoreboard:
 *   https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard
 *
 * Cut status is inferred via the "top 50 + ties" rule applied to 2-round totals.
 */

export interface EspnPlayer {
  espnPlayerId: string
  name: string
  status: 'active' | 'cut' | 'wd'
  totalStrokes: number | null   // relative to par, e.g. -12, +4, 0
  todayStrokes: number | null   // relative to par for current round
  thru: string | null           // e.g. "F", "9", "-"
  position: string | null       // e.g. "1", "T5"
  teeTime: string | null        // e.g. "9:20 AM ET" when player hasn't started today
  r1Strokes: number | null      // relative to par for round 1
  r2Strokes: number | null
  r3Strokes: number | null
  r4Strokes: number | null
}

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
}

interface RawLinescore {
  value: number
  displayValue: string
  period: number
  linescores?: RawLinescore[]   // nested hole-by-hole data when in progress
  statistics?: {
    categories?: Array<{
      stats?: Array<{ value?: number; displayValue?: string }>
    }>
  }
}

interface RawCompetitor {
  id: string
  order?: number
  athlete?: { fullName?: string; displayName?: string; shortName?: string }
  score?: string                // relative-to-par string, e.g. "-12", "+4", "E"
  linescores?: RawLinescore[]
}

function parseRelPar(s: string | undefined | null): number | null {
  if (!s) return null
  if (s === 'E' || s === 'EVEN' || s === '-') return 0
  const n = parseInt(s, 10)
  return isNaN(n) ? null : n
}

function roundLinescore(linescores: RawLinescore[], period: number): RawLinescore | undefined {
  return linescores.find((l) => l.period === period)
}

/**
 * Extract tee time from a round linescore's statistics.
 * ESPN stores it as the last stat: "Sun Apr 12 14:25:00 PDT 2026"
 * The time is in Eastern (despite the "PDT" label — ESPN bug).
 */
function extractTeeTime(linescore: RawLinescore | undefined): string | null {
  if (!linescore) return null
  const dateStr = linescore.statistics?.categories?.[0]?.stats?.at(-1)?.displayValue
  if (!dateStr) return null
  // Match "14:25" from "Sun Apr 12 14:25:00 PDT 2026"
  const match = dateStr.match(/(\d{1,2}):(\d{2}):\d{2}/)
  if (!match) return null
  let hours = parseInt(match[1], 10)
  const minutes = match[2]
  const period = hours >= 12 ? 'PM' : 'AM'
  if (hours > 12) hours -= 12
  if (hours === 0) hours = 12
  return `${hours}:${minutes} ${period} ET`
}

function determineCutLine(competitors: RawCompetitor[]): number {
  // Build sorted list of 2-round totals (raw strokes, lower = better)
  const totals = competitors
    .map((c) => {
      const r1 = roundLinescore(c.linescores ?? [], 1)?.value ?? 9999
      const r2 = roundLinescore(c.linescores ?? [], 2)?.value ?? 9999
      // Only include if player has completed 2 rounds
      return r1 < 9999 && r2 < 9999 ? r1 + r2 : 9999
    })
    .filter((t) => t < 9999)
    .sort((a, b) => a - b)

  // Top 50 + ties: cut line = score of the 50th player
  const cutIndex = Math.min(49, totals.length - 1)
  return totals[cutIndex] ?? 9999
}

function inferStatus(c: RawCompetitor, cutLine: number): 'active' | 'cut' | 'wd' {
  const r1 = roundLinescore(c.linescores ?? [], 1)?.value ?? 0
  const r2 = roundLinescore(c.linescores ?? [], 2)?.value ?? 0

  // No round scores at all → likely withdrew before the tournament
  if (r1 === 0 && r2 === 0) return 'wd'

  // Has r1 but no r2 → withdrew or incomplete (treat as wd)
  if (r1 > 0 && r2 === 0) return 'wd'

  return r1 + r2 <= cutLine ? 'active' : 'cut'
}

function inferThru(c: RawCompetitor): string | null {
  const linescores = c.linescores ?? []
  // Most recent started round first
  const started = linescores.filter((l) => l.value > 0).sort((a, b) => b.period - a.period)
  const current = started[0]
  if (!current) return null

  // If the round in progress has hole-by-hole data, count completed holes
  if (current.linescores?.length) {
    const holesPlayed = current.linescores.length
    return holesPlayed >= 18 ? 'F' : String(holesPlayed)
  }

  // Completed round (value > 0, no hole data). If there's an unplayed round after
  // this one (value === 0), today's round hasn't started yet — return null.
  const hasUnplayedRoundAhead = linescores.some(
    (l) => l.period > current.period && l.value === 0
  )
  if (hasUnplayedRoundAhead) return null

  return 'F'
}

async function fetchScoreboard(): Promise<{ eventId: string; competitors: RawCompetitor[] } | null> {
  const res = await fetch(SCOREBOARD_URL, { headers: HEADERS, cache: 'no-store' })
  if (!res.ok) return null
  const data = await res.json()
  const event = data?.events?.[0]
  if (!event) return null
  const competitors: RawCompetitor[] = event?.competitions?.[0]?.competitors ?? []
  return { eventId: event.id, competitors }
}

export async function fetchEspnLeaderboard(_espnEventId: string): Promise<EspnPlayer[]> {
  const result = await fetchScoreboard()
  if (!result) throw new Error('ESPN scoreboard fetch failed')

  const { competitors } = result
  if (competitors.length === 0) throw new Error('No competitors in ESPN scoreboard')

  const cutLine = determineCutLine(competitors)

  return competitors.map((c) => {
    const r1 = roundLinescore(c.linescores ?? [], 1)
    const r2 = roundLinescore(c.linescores ?? [], 2)
    const r3 = roundLinescore(c.linescores ?? [], 3)
    const r4 = roundLinescore(c.linescores ?? [], 4)
    const currentRound = r4 ?? r3

    // Today's score: only set if the player has actually started the current round
    const todayStrokes = (currentRound && currentRound.value > 0)
      ? parseRelPar(currentRound.displayValue)
      : null

    const thru = inferThru(c)

    // Tee time: stored in the unstarted round's linescore statistics (last stat entry).
    // Only extract if the player hasn't started today's round (thru is null).
    const unplayedRound = (c.linescores ?? []).find((l) => l.value === 0)
    const teeTime = !thru ? extractTeeTime(unplayedRound) : null

    return {
      espnPlayerId: c.id,
      name: c.athlete?.displayName ?? c.athlete?.fullName ?? 'Unknown',
      status: inferStatus(c, cutLine),
      totalStrokes: parseRelPar(c.score),
      todayStrokes,
      thru,
      position: c.order != null ? String(c.order) : null,
      teeTime,
      r1Strokes: r1 ? parseRelPar(r1.displayValue) : null,
      r2Strokes: r2 ? parseRelPar(r2.displayValue) : null,
      r3Strokes: r3 ? parseRelPar(r3.displayValue) : null,
      r4Strokes: r4 ? parseRelPar(r4.displayValue) : null,
    }
  })
}

/** Fetch the currently active PGA tour event ID from ESPN scoreboard */
export async function fetchCurrentEspnEventId(): Promise<string | null> {
  const result = await fetchScoreboard()
  return result?.eventId ?? null
}
