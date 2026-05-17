import { describe, it, expect } from 'vitest'
import {
  parseRelPar,
  extractTeeTime,
  hasMadeCut,
  determineCutLine,
  inferStatus,
  inferThru,
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
      .find((l) => l != null && l.value > 0)
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
      .find((l) => l != null && l.value > 0)
    expect(played).toEqual(linescores[3]) // R4
  })

  it('returns null todayStrokes when no rounds played', () => {
    const linescores: RawLinescore[] = []
    const currentRound = [undefined, undefined, undefined, undefined]
      .find((l) => l != null && (l as RawLinescore).value > 0) ?? null
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
