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

// Canonical check: has a round linescore been played?
// Uses displayValue (e.g. "-3", "E", "+2") rather than value, which can be
// negative (under par) or 0 (even par), making it ambiguous with unplayed rounds.
function roundPlayed(ls: RawLinescore | undefined): boolean {
  if (!ls) return false
  const dv = ls.displayValue?.trim()
  if (!dv || dv === '-') return false
  return parseRelPar(dv) != null
}

// Returns true if a player has confirmed they made the cut:
// either they have R3/R4 score data, or they have an R3 tee time scheduled.
function hasMadeCut(c: RawCompetitor): boolean {
  const r3ls = roundLinescore(c.linescores ?? [], 3)
  const r4ls = roundLinescore(c.linescores ?? [], 4)
  if (roundPlayed(r3ls) || roundPlayed(r4ls)) return true
  // R3 tee time present → player is scheduled for R3 (made the cut)
  return extractTeeTime(r3ls) !== null
}

function determineCutLine(competitors: RawCompetitor[]): number {
  // Derive actual cut line from who made it to R3:
  // worst 2-round total among players in the R3 field = the real cut line.
  const madeR3 = competitors.filter(hasMadeCut)

  if (madeR3.length > 0) {
    const totals = madeR3.map((c) => {
      const r1 = parseRelPar(roundLinescore(c.linescores ?? [], 1)?.displayValue) ?? 0
      const r2 = parseRelPar(roundLinescore(c.linescores ?? [], 2)?.displayValue) ?? 0
      return r1 + r2
    })
    return Math.max(...totals)
  }

  // Cut hasn't happened yet (rounds 1-2 in progress) — estimate from sorted totals
  const totals = competitors
    .map((c) => {
      const r1 = parseRelPar(roundLinescore(c.linescores ?? [], 1)?.displayValue)
      const r2 = parseRelPar(roundLinescore(c.linescores ?? [], 2)?.displayValue)
      return r1 != null && r2 != null ? r1 + r2 : null
    })
    .filter((t): t is number => t != null)
    .sort((a, b) => a - b)

  // Use top 70 as a safe estimate (covers both regular events and majors)
  const cutIndex = Math.min(69, totals.length - 1)
  return totals[cutIndex] ?? 9999
}

function inferStatus(c: RawCompetitor, cutLine: number): 'active' | 'cut' | 'wd' {
  const r1ls = roundLinescore(c.linescores ?? [], 1)
  const r2ls = roundLinescore(c.linescores ?? [], 2)

  // No R1 score → withdrew before tournament
  if (!roundPlayed(r1ls)) return 'wd'

  // R1 played but no R2 → withdrew after R1
  if (!roundPlayed(r2ls)) return 'wd'

  // R3 tee time or R3/R4 scores → definitively made the cut
  if (hasMadeCut(c)) return 'active'

  const r1 = parseRelPar(r1ls!.displayValue) ?? 0
  const r2 = parseRelPar(r2ls!.displayValue) ?? 0
  return r1 + r2 <= cutLine ? 'active' : 'cut'
}

function inferThru(c: RawCompetitor): string | null {
  const linescores = c.linescores ?? []
  // Most recent played round first
  const started = linescores.filter(roundPlayed).sort((a, b) => b.period - a.period)
  const current = started[0]
  if (!current) return null

  const hasUnplayedRoundAhead = linescores.some(
    (l) => l.period > current.period && !roundPlayed(l)
  )

  if (current.linescores?.length) {
    const holesPlayed = current.linescores.length
    if (holesPlayed >= 18) {
      // All 18 holes recorded — but if a later round is still unplayed, this is a
      // completed past round and today hasn't started yet.
      if (hasUnplayedRoundAhead) return null
      return 'F'
    }
    // Fewer than 18 holes → currently in progress
    return String(holesPlayed)
  }

  // No hole-by-hole data. If an unplayed round exists ahead, player is between rounds.
  if (hasUnplayedRoundAhead) return null
  return 'F'
}

async function fetchScoreboard(): Promise<{ eventId: string; eventName: string; eventDate: string | null; competitors: RawCompetitor[] } | null> {
  const res = await fetch(SCOREBOARD_URL, { headers: HEADERS, cache: 'no-store' })
  if (!res.ok) return null
  const data = await res.json()
  const event = data?.events?.[0]
  if (!event) return null
  const competitors: RawCompetitor[] = event?.competitions?.[0]?.competitors ?? []
  // eventDate: prefer competitions[0].date, fall back to event.date (ISO string)
  const rawDate: string | null = event?.competitions?.[0]?.date ?? event?.date ?? null
  const eventDate = rawDate ? rawDate.slice(0, 10) : null // YYYY-MM-DD
  return { eventId: event.id, eventName: event.name ?? event.shortName ?? '', eventDate, competitors }
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
    const todayStrokes = roundPlayed(currentRound ?? undefined)
      ? parseRelPar(currentRound!.displayValue)
      : null

    const thru = inferThru(c)

    // Tee time: stored in the unstarted round's linescore statistics (last stat entry).
    // Only extract if the player hasn't started today's round (thru is null).
    const unplayedRound = (c.linescores ?? []).find((l) => !roundPlayed(l))
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

/** Fetch the currently active PGA tour event from ESPN scoreboard */
export async function fetchCurrentEspnEventId(): Promise<string | null> {
  const result = await fetchScoreboard()
  return result?.eventId ?? null
}

export async function fetchCurrentEspnEvent(): Promise<{ eventId: string; eventName: string; eventDate: string | null } | null> {
  const result = await fetchScoreboard()
  if (!result) return null
  return { eventId: result.eventId, eventName: result.eventName, eventDate: result.eventDate }
}
