import { describe, it, expect } from 'vitest'
import {
  parseRelPar,
  extractTeeTime,
  hasMadeCut,
  determineCutLine,
  inferStatus,
  inferThru,
  isRoundPlayed,
  espnLeaderboardFromPayload,
  playersFromCompetitors,
  type RawLinescore,
  type RawCompetitor,
} from '@/lib/espn'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ls(period: number, value: number, displayValue: string, holes?: number): RawLinescore {
  return {
    period,
    value,
    displayValue,
    linescores: holes != null ? Array.from({ length: holes }, (_, i) => ({
      period: i + 1, value: 4, displayValue: '4',
    })) : undefined,
  }
}

function lsWithTeeTime(period: number, teeTime: string): RawLinescore {
  return {
    period,
    value: 0,
    displayValue: '',
    statistics: {
      categories: [{ stats: [{ displayValue: teeTime }] }],
    },
  }
}

function competitor(linescores: RawLinescore[], score = 'E'): RawCompetitor {
  return { id: '1', score, linescores }
}

// ─── parseRelPar ──────────────────────────────────────────────────────────────

describe('parseRelPar', () => {
  it('returns null for null/undefined/empty', () => {
    expect(parseRelPar(null)).toBeNull()
    expect(parseRelPar(undefined)).toBeNull()
    expect(parseRelPar('')).toBeNull()
  })

  it('returns 0 for E, EVEN, -', () => {
    expect(parseRelPar('E')).toBe(0)
    expect(parseRelPar('EVEN')).toBe(0)
    expect(parseRelPar('-')).toBe(0)
  })

  it('parses positive scores', () => {
    expect(parseRelPar('+4')).toBe(4)
    expect(parseRelPar('4')).toBe(4)
  })

  it('parses negative scores', () => {
    expect(parseRelPar('-3')).toBe(-3)
    expect(parseRelPar('-12')).toBe(-12)
  })

  it('parses raw stroke totals', () => {
    expect(parseRelPar('70')).toBe(70)
    expect(parseRelPar('68')).toBe(68)
  })

  it('returns null for non-numeric strings', () => {
    expect(parseRelPar('abc')).toBeNull()
    expect(parseRelPar('F')).toBeNull()
  })
})

// ─── extractTeeTime ───────────────────────────────────────────────────────────

describe('extractTeeTime', () => {
  it('returns null for undefined', () => {
    expect(extractTeeTime(undefined)).toBeNull()
  })

  it('returns null when no statistics', () => {
    expect(extractTeeTime(ls(3, 0, ''))).toBeNull()
  })

  it('parses afternoon tee time', () => {
    const l = lsWithTeeTime(3, 'Sun Apr 12 14:25:00 PDT 2026')
    expect(extractTeeTime(l)).toBe('2:25 PM ET')
  })

  it('parses morning tee time', () => {
    const l = lsWithTeeTime(3, 'Sat Apr 11 09:05:00 PDT 2026')
    expect(extractTeeTime(l)).toBe('9:05 AM ET')
  })

  it('parses noon correctly', () => {
    const l = lsWithTeeTime(3, 'Sun Apr 12 12:00:00 PDT 2026')
    expect(extractTeeTime(l)).toBe('12:00 PM ET')
  })

  it('parses midnight correctly', () => {
    const l = lsWithTeeTime(3, 'Sun Apr 12 00:30:00 PDT 2026')
    expect(extractTeeTime(l)).toBe('12:30 AM ET')
  })
})

// ─── hasMadeCut ───────────────────────────────────────────────────────────────

describe('hasMadeCut', () => {
  it('returns true when R3 has a score', () => {
    const c = competitor([ls(1, 70, '+2'), ls(2, 68, '-2'), ls(3, 71, '+1')])
    expect(hasMadeCut(c)).toBe(true)
  })

  it('returns true when R4 has a score', () => {
    const c = competitor([ls(1, 70, '+2'), ls(2, 68, '-2'), ls(3, 69, '-1'), ls(4, 67, '-3')])
    expect(hasMadeCut(c)).toBe(true)
  })

  it('returns true when R3 tee time is scheduled', () => {
    const c = competitor([ls(1, 70, '+2'), ls(2, 68, '-2'), lsWithTeeTime(3, 'Sun Apr 12 14:25:00 PDT 2026')])
    expect(hasMadeCut(c)).toBe(true)
  })

  it('returns false with only R1/R2 and no R3 tee time', () => {
    const c = competitor([ls(1, 70, '+2'), ls(2, 68, '-2')])
    expect(hasMadeCut(c)).toBe(false)
  })

  it('returns false when R3 exists but value=0 and no tee time', () => {
    const c = competitor([ls(1, 70, '+2'), ls(2, 68, '-2'), ls(3, 0, '')])
    expect(hasMadeCut(c)).toBe(false)
  })

  it('returns true for under-par R3 score (negative value is irrelevant — value is raw strokes)', () => {
    // value is raw strokes, always > 0 when played
    const c = competitor([ls(1, 70, '+2'), ls(2, 68, '-2'), ls(3, 65, '-5')])
    expect(hasMadeCut(c)).toBe(true)
  })
})

// ─── determineCutLine ─────────────────────────────────────────────────────────

describe('determineCutLine', () => {
  it('uses worst 2-round relative total among R3 players', () => {
    // Player A: r1=-2, r2=-1 → total=-3 (made cut, R3 played)
    // Player B: r1=+1, r2=+2 → total=+3 (made cut, R3 played)
    // Player C: r1=+4, r2=+2 → total=+6 (missed cut, no R3)
    const players: RawCompetitor[] = [
      competitor([ls(1, 70, '-2'), ls(2, 71, '-1'), ls(3, 68, '-4')]),
      competitor([ls(1, 73, '+1'), ls(2, 74, '+2'), ls(3, 70, 'E')]),
      competitor([ls(1, 76, '+4'), ls(2, 74, '+2')]),
    ]
    expect(determineCutLine(players)).toBe(3) // max of (-3, +3) = +3
  })

  it('falls back to sorted estimate when no R3 data exists', () => {
    // 3 players, top 70 estimate (min(69, 2) = 2 → index 2 → worst score)
    const players: RawCompetitor[] = [
      competitor([ls(1, 68, '-4'), ls(2, 70, 'E')]),
      competitor([ls(1, 70, 'E'), ls(2, 72, '+2')]),
      competitor([ls(1, 74, '+2'), ls(2, 75, '+3')]),
    ]
    const line = determineCutLine(players)
    expect(line).toBe(5) // worst 2-round total (+2+3=5)
  })

  it('returns 9999 when no competitors have 2 rounds', () => {
    const players: RawCompetitor[] = [
      competitor([ls(1, 70, 'E')]),
    ]
    expect(determineCutLine(players)).toBe(9999)
  })
})

// ─── inferStatus ─────────────────────────────────────────────────────────────

describe('inferStatus', () => {
  it('returns wd when no R1', () => {
    const c = competitor([])
    expect(inferStatus(c, 0)).toBe('wd')
  })

  it('returns wd when R1 played but no R2', () => {
    const c = competitor([ls(1, 70, 'E')])
    expect(inferStatus(c, 0)).toBe('wd')
  })

  it('returns wd when R1 value=0 (unplayed)', () => {
    const c = competitor([ls(1, 0, ''), ls(2, 0, '')])
    expect(inferStatus(c, 0)).toBe('wd')
  })

  it('returns active when R3 score exists', () => {
    const c = competitor([ls(1, 70, 'E'), ls(2, 72, '+2'), ls(3, 68, '-4')])
    expect(inferStatus(c, 999)).toBe('active')
  })

  it('returns active when R3 tee time scheduled', () => {
    const c = competitor([ls(1, 70, 'E'), ls(2, 72, '+2'), lsWithTeeTime(3, 'Sun Apr 12 14:00:00 PDT 2026')])
    expect(inferStatus(c, 999)).toBe('active')
  })

  it('returns active when 2-round total is at the cut line', () => {
    const c = competitor([ls(1, 70, 'E'), ls(2, 72, '+2')]) // total = +2
    expect(inferStatus(c, 2)).toBe('active') // <= cutLine
  })

  it('returns cut when 2-round total exceeds cut line', () => {
    const c = competitor([ls(1, 74, '+2'), ls(2, 75, '+3')]) // total = +5
    expect(inferStatus(c, 2)).toBe('cut') // > cutLine
  })

  it('returns active for under-par players who made cut', () => {
    const c = competitor([ls(1, 66, '-6'), ls(2, 67, '-5')]) // total = -11
    expect(inferStatus(c, 3)).toBe('active')
  })
})

// ─── inferThru ────────────────────────────────────────────────────────────────

describe('inferThru', () => {
  it('returns null when no rounds played', () => {
    expect(inferThru(competitor([]))).toBeNull()
  })

  it('returns null between R1 and R2 (R1 complete, R2 unplayed)', () => {
    const c = competitor([ls(1, 70, 'E', 18), ls(2, 0, '')])
    expect(inferThru(c)).toBeNull()
  })

  it('returns null between R2 and R3 (R2 complete with no hole data, R3 unplayed)', () => {
    const c = competitor([ls(1, 70, 'E'), ls(2, 72, '+2'), ls(3, 0, '')])
    expect(inferThru(c)).toBeNull()
  })

  it('returns hole count when R3 in progress', () => {
    const c = competitor([ls(1, 70, 'E'), ls(2, 72, '+2'), ls(3, 69, '-1', 9)])
    expect(inferThru(c)).toBe('9')
  })

  it('returns F when R3 complete with 18 holes and no R4 unplayed ahead', () => {
    const c = competitor([ls(1, 70, 'E'), ls(2, 72, '+2'), ls(3, 69, '-1', 18)])
    expect(inferThru(c)).toBe('F')
  })

  it('returns null when R3 shows 18 holes but R4 is unplayed ahead', () => {
    const c = competitor([ls(1, 70, 'E'), ls(2, 72, '+2'), ls(3, 69, '-1', 18), ls(4, 0, '')])
    expect(inferThru(c)).toBeNull()
  })

  it('returns F when R4 complete with no hole data', () => {
    const c = competitor([ls(1, 70, 'E'), ls(2, 72, '+2'), ls(3, 69, '-1'), ls(4, 68, '-2')])
    expect(inferThru(c)).toBe('F')
  })

  it('returns F when R1 complete with no following unplayed round', () => {
    const c = competitor([ls(1, 70, 'E')])
    expect(inferThru(c)).toBe('F')
  })

  it('returns 13 when R1 in progress with 13 holes', () => {
    const c = competitor([ls(1, 69, '-1', 13)])
    expect(inferThru(c)).toBe('13')
  })
})

// ─── currentRound / todayStrokes selection ────────────────────────────────────
// Tested indirectly via the full competitor shape used in fetchEspnLeaderboard.
// We verify that a placeholder R4 (value=0) does not shadow a completed R3.

describe('currentRound selection', () => {
  it('picks R3 when R4 exists but is unplayed (value=0)', () => {
    // Simulate what ESPN sends after R3 finishes: R4 placeholder with value=0
    const linescores = [
      ls(1, 70, 'E'),
      ls(2, 72, '+2'),
      ls(3, 68, '-4'),
      ls(4, 0, ''),       // placeholder
    ]
    const played = [linescores[3], linescores[2], linescores[1], linescores[0]]
      .find(isRoundPlayed)
    expect(played).toEqual(linescores[2]) // R3
    expect(played?.displayValue).toBe('-4')
  })

  it('picks R4 when R4 has been played', () => {
    const linescores = [
      ls(1, 70, 'E'),
      ls(2, 72, '+2'),
      ls(3, 68, '-4'),
      ls(4, 67, '-5'),
    ]
    const played = [linescores[3], linescores[2], linescores[1], linescores[0]]
      .find(isRoundPlayed)
    expect(played).toEqual(linescores[3]) // R4
  })

  it('returns null todayStrokes when no rounds played', () => {
    const linescores: RawLinescore[] = []
    const currentRound = [undefined, undefined, undefined, undefined]
      .find(isRoundPlayed) ?? null
    expect(currentRound).toBeNull()
  })
})

// ─── auto-complete guard ──────────────────────────────────────────────────────

describe('auto-complete guard (r4_strokes required)', () => {
  it('does NOT complete when thru=F but r4_strokes is null', () => {
    const scores = [
      { thru: 'F', r4_strokes: null },
      { thru: 'F', r4_strokes: null },
    ]
    const allFinished = scores.length > 0 &&
      scores.every((s) => s.thru === 'F' && s.r4_strokes !== null)
    expect(allFinished).toBe(false)
  })

  it('completes when all players have thru=F AND r4_strokes', () => {
    const scores = [
      { thru: 'F', r4_strokes: -2 },
      { thru: 'F', r4_strokes: 1 },
    ]
    const allFinished = scores.length > 0 &&
      scores.every((s) => s.thru === 'F' && s.r4_strokes !== null)
    expect(allFinished).toBe(true)
  })

  it('does NOT complete when one player is still in progress', () => {
    const scores = [
      { thru: 'F', r4_strokes: -2 },
      { thru: '14', r4_strokes: null },
    ]
    const allFinished = scores.length > 0 &&
      scores.every((s) => s.thru === 'F' && s.r4_strokes !== null)
    expect(allFinished).toBe(false)
  })
})

// ─── bare placeholder rounds (TOUR Championship shape) ────────────────────────
// ESPN sends `{ period: 3 }` — no `value`, no `displayValue` — for a round that
// hasn't started, instead of the `value: 0` placeholder the majors use.

/** A round ESPN has not started yet, with no value key at all. */
function bare(period: number): RawLinescore {
  return { period }
}

describe('isRoundPlayed', () => {
  it('is true for a played round (value = raw strokes)', () => {
    expect(isRoundPlayed(ls(1, 68, '-3'))).toBe(true)
  })

  it('is false for a value=0 placeholder', () => {
    expect(isRoundPlayed(ls(4, 0, ''))).toBe(false)
  })

  it('is false for a bare { period } placeholder', () => {
    expect(isRoundPlayed(bare(3))).toBe(false)
  })

  it('is false for missing/undefined linescores', () => {
    expect(isRoundPlayed(undefined)).toBe(false)
    expect(isRoundPlayed(null)).toBe(false)
  })
})

describe('bare placeholder handling', () => {
  it('hasMadeCut is false when R3 is a bare placeholder', () => {
    expect(hasMadeCut(competitor([ls(1, 70, 'E'), ls(2, 68, '-2'), bare(3)]))).toBe(false)
  })

  it('inferThru returns null between rounds when the next round is a bare placeholder', () => {
    // R2 complete (18 holes) and R3 not yet started — today has not begun,
    // so the finished R2 must not report as 'F'.
    const c = competitor([ls(1, 70, 'E', 18), ls(2, 68, '-2', 18), bare(3)])
    expect(inferThru(c)).toBeNull()
  })

  it('inferThru still reports F when no later round exists at all', () => {
    const c = competitor([ls(1, 70, 'E', 18), ls(2, 68, '-2', 18)])
    expect(inferThru(c)).toBe('F')
  })

  it('currentRound picks R2 when R3 is a bare placeholder', () => {
    const linescores = [ls(1, 70, 'E'), ls(2, 68, '-2'), bare(3)]
    const played = [undefined, linescores[2], linescores[1], linescores[0]].find(isRoundPlayed)
    expect(played).toEqual(linescores[1])
  })

  it('tee-time lookup finds the bare placeholder round', () => {
    const teeLs: RawLinescore = {
      ...bare(3),
      statistics: { categories: [{ stats: [{ displayValue: 'Sat Aug 29 13:40:00 PDT 2026' }] }] },
    }
    const linescores = [ls(1, 70, 'E'), ls(2, 68, '-2'), teeLs]
    const unplayed = linescores.find((l) => !isRoundPlayed(l))
    expect(extractTeeTime(unplayed)).toBe('1:40 PM ET')
  })

  it('no-cut field: nobody is cut when every R3 is a bare placeholder', () => {
    // 30-player TOUR Championship field, no cut. Falls back to the sorted-totals
    // estimate; with fewer than 70 players that is the worst total, so all stay active.
    const field = [-10, -5, 0, 4].map((total) =>
      competitor([ls(1, 70, String(total)), ls(2, 70, 'E'), bare(3)])
    )
    const cutLine = determineCutLine(field)
    expect(cutLine).toBe(4)
    expect(field.map((c) => inferStatus(c, cutLine))).toEqual(['active', 'active', 'active', 'active'])
  })
})

// ─── client-supplied scoreboard payloads ──────────────────────────────────────
// Vercel cannot reach site.api.espn.com, so the browser fetches the scoreboard and
// hands the raw payload back for ingestion. Parsing must work on that payload.

describe('espnLeaderboardFromPayload', () => {
  const payload = {
    events: [{
      id: '401811964',
      name: 'TOUR Championship',
      competitions: [{
        date: '2026-08-27T04:00Z',
        competitors: [
          { id: '1', order: 1, score: '-10', athlete: { displayName: 'Ryan Gerard' },
            linescores: [ls(1, 65, '-5', 18), ls(2, 65, '-5', 18), bare(3)] },
          { id: '2', order: 2, score: '+4', athlete: { displayName: 'J.J. Spaun' },
            linescores: [ls(1, 76, '+4', 18), { period: 2, value: 0, displayValue: '-' }] },
        ],
      }],
    }],
  }

  it('extracts event identity and players', () => {
    const lb = espnLeaderboardFromPayload(payload)
    expect(lb?.eventId).toBe('401811964')
    expect(lb?.eventName).toBe('TOUR Championship')
    expect(lb?.eventDate).toBe('2026-08-27')
    expect(lb?.players).toHaveLength(2)
  })

  it('parses scores the same way the server fetch does', () => {
    const gerard = espnLeaderboardFromPayload(payload)!.players[0]
    expect(gerard.name).toBe('Ryan Gerard')
    expect(gerard.status).toBe('active')
    expect(gerard.totalStrokes).toBe(-10)
    expect(gerard.r1Strokes).toBe(-5)
    expect(gerard.r2Strokes).toBe(-5)
    expect(gerard.thru).toBeNull()   // R3 has not started
  })

  it('still flags a withdrawal', () => {
    expect(espnLeaderboardFromPayload(payload)!.players[1].status).toBe('wd')
  })

  it('returns null for junk or empty payloads', () => {
    expect(espnLeaderboardFromPayload(null)).toBeNull()
    expect(espnLeaderboardFromPayload({})).toBeNull()
    expect(espnLeaderboardFromPayload({ events: [] })).toBeNull()
    expect(espnLeaderboardFromPayload({ events: [{ id: '1', competitions: [{ competitors: [] }] }] })).toBeNull()
  })
})

describe('unplayed rounds report no score', () => {
  it('does not read the "-" placeholder as even par', () => {
    // J.J. Spaun withdrew after R1: ESPN sends R2 as value 0 / displayValue '-'.
    // That is "no score", not a level-par round.
    const c = competitor([ls(1, 76, '+4', 18), { period: 2, value: 0, displayValue: '-' }])
    const [player] = playersFromCompetitors([c])
    expect(player.r1Strokes).toBe(4)
    expect(player.r2Strokes).toBeNull()
    expect(player.status).toBe('wd')
  })

  it('reports null for a bare placeholder round', () => {
    const c = competitor([ls(1, 70, 'E', 18), ls(2, 68, '-2', 18), bare(3)])
    const [player] = playersFromCompetitors([c])
    expect(player.r2Strokes).toBe(-2)
    expect(player.r3Strokes).toBeNull()
  })
})
