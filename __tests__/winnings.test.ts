import { describe, it, expect } from 'vitest'
import { computeWinnings, isTurd, turdSize } from '@/lib/winnings'

// ─── computeWinnings ──────────────────────────────────────────────────────────

function team(id: string, total: number | null, playerScores: (number | null)[]) {
  return {
    user_id: id,
    total_strokes: total,
    picks: playerScores.map((s) => ({ total_strokes: s })),
  }
}

describe('computeWinnings', () => {
  it('every team starts at -$20 buy-in', () => {
    const standings = [team('A', -10, [-10]), team('B', -5, [-5])]
    const w = computeWinnings(standings)
    // Before prizes, both paid $20 in
    expect(w.get('A')! + 20).toBeGreaterThan(0) // A wins something
    expect(w.get('B')).toBeDefined()
  })

  it('best team gets $30 + $5 side-bet + $50 best player', () => {
    const standings = [
      team('A', -10, [-10]),
      team('B', -5, [-5]),
    ]
    const w = computeWinnings(standings)
    // A: -20 + 30 (best team) + 5 (side-bet) + 50 (owns best player -10) = +65
    expect(w.get('A')).toBe(65)
    // B: -20 - 5 (side-bet) = -25
    expect(w.get('B')).toBe(-25)
  })

  it('best player prize goes to team that owns the leader', () => {
    const standings = [
      team('A', -10, [-12, -2]),  // A owns -12 (best player)
      team('B', -8,  [-8, 0]),
    ]
    const w = computeWinnings(standings)
    // A: -20 + 30 (best team) + 5 (side-bet) + 50 (best player) = +65
    expect(w.get('A')).toBe(65)
    // B: -20 - 5 = -25
    expect(w.get('B')).toBe(-25)
  })

  it('splits $30 evenly on tied best teams', () => {
    const standings = [
      team('A', -10, [-10]),
      team('B', -10, [-10]),
      team('C', -5,  [-5]),
    ]
    const w = computeWinnings(standings)
    // Best player is -10, tied between A and B → each gets $25
    // Best team tied A+B: each gets 15 (30/2), side-bet: C pays 5 split to A+B (+2.5 each)
    // A: -20 + 15 + 2.5 + 25 = 22.5
    expect(w.get('A')).toBe(w.get('B'))
    expect(w.get('A')).toBe(22.5)
    // C: -20 - 5 = -25
    expect(w.get('C')).toBe(-25)
  })

  it('splits $50 best-player prize when two teams share the leader', () => {
    const standings = [
      team('A', -10, [-12]),
      team('B', -8,  [-12]), // both own a player at -12
    ]
    const w = computeWinnings(standings)
    // A: -20 + 30 (best team) + 5 (side-bet) + 25 (half best player) = 40
    expect(w.get('A')).toBe(40)
    // B: -20 - 5 (side-bet) + 25 (half best player) = 0
    expect(w.get('B')).toBe(0)
    // difference = 30 + 5 + 0 (split player cancels out) = 40
    expect(w.get('A')! - w.get('B')!).toBe(40)
  })

  it('no side-bet when only one team', () => {
    const standings = [team('A', -10, [-10])]
    const w = computeWinnings(standings)
    // A: -20 + 30 (best team) + 50 (best player) = +60 (no side-bet, only team)
    expect(w.get('A')).toBe(60)
  })

  it('no prizes when all scores are null', () => {
    const standings = [team('A', null, [null]), team('B', null, [null])]
    const w = computeWinnings(standings)
    expect(w.get('A')).toBe(-20)
    expect(w.get('B')).toBe(-20)
  })

  it('no side-bet when best and worst team have same score', () => {
    const standings = [team('A', -5, [-5]), team('B', -5, [-3, -2])]
    const w = computeWinnings(standings)
    // Tied — no side bet, $30 split, $50 to owner of -5
    const total = [...w.values()].reduce((a, b) => a + b, 0)
    // Net pool: -20*2 + 30 + 50 = 20 paid in, 80 paid out = net +20 to players total...
    // Actually total winnings should = sum of prizes - sum of buy-ins
    expect(total).toBe(-40 + 30 + 50) // = +40... wait
    // -20 each = -40 total buy-in, +80 in prizes = net payout of +40 to the group
    // but prizes don't change total pot... let me check:
    // prizes are redistributed FROM the buy-ins, so total should sum to 0
    // Actually: buy-in = -20 each, prizes = +50 best player + +30 best team + side bets
    // Total = -40 (buy-ins) + 80 (prizes) is only valid if I'm tracking net correctly
    // The function starts everyone at -20 then ADDS prizes on top
    // So net total = -40 + 30 + 50 = +40... that's the net paid out from the pot
    // This is correct — total net of all winnings should be +40 after redistribution
    expect(total).toBe(40)
  })
})

// ─── isTurd ───────────────────────────────────────────────────────────────────

describe('isTurd', () => {
  it('returns false when today_strokes is null', () => {
    expect(isTurd(null, -1)).toBe(false)
  })

  it('caller must filter to started players (thru !== null) before calling', () => {
    // isTurd itself has no thru awareness — callers filter first
    // This test documents the contract: pass null if player has not started
    expect(isTurd(null, -2)).toBe(false)
  })

  it('returns false when fieldAvgToday is null', () => {
    expect(isTurd(3, null)).toBe(false)
  })

  it('returns true when 3+ worse than field avg', () => {
    expect(isTurd(2, -1)).toBe(true)  // 2 >= -1 + 3
    expect(isTurd(3, 0)).toBe(true)   // 3 >= 0 + 3
    expect(isTurd(5, 1)).toBe(true)   // 5 >= 1 + 3
  })

  it('returns true when exactly 2 worse than avg but positive while avg is negative', () => {
    // today=+1, avg=-1: not 3+ worse (1 < 2), BUT positive while avg is negative → turd
    expect(isTurd(1, -1)).toBe(true)
  })

  it('returns false when negative and not 3+ worse than avg', () => {
    expect(isTurd(-1, -2)).toBe(false) // -1 < -2+3=1 and not positive
  })

  it('returns true when positive while field is negative', () => {
    expect(isTurd(1, -2)).toBe(true)  // positive AND avg < 0
    expect(isTurd(1, -0.5)).toBe(true)
  })

  it('returns false when negative even if field is also negative', () => {
    expect(isTurd(-1, -2)).toBe(false) // -1 < -2 + 3 = 1, and not positive
  })

  it('returns false when even par and field avg is negative but within 2', () => {
    expect(isTurd(0, -2)).toBe(false) // 0 is not > 0, and 0 < -2+3=1
  })

  it('returns false when field avg is positive and player is at field avg', () => {
    expect(isTurd(2, 2)).toBe(false) // 2 < 2+3=5
  })

  it('returns true when exactly at field avg + 3', () => {
    expect(isTurd(3, 0)).toBe(true)
    expect(isTurd(0, -3)).toBe(true)
  })
})

// ─── turdSize ─────────────────────────────────────────────────────────────────

describe('turdSize', () => {
  it('returns max size (2rem) for worst turd', () => {
    expect(turdSize(5, 2, 5)).toBe('2.00rem')
  })

  it('returns min size (0.8rem) for best turd', () => {
    expect(turdSize(2, 2, 5)).toBe('0.80rem')
  })

  it('returns max size when only one turd (min === max)', () => {
    expect(turdSize(3, 3, 3)).toBe('2.00rem')
  })

  it('scales linearly between min and max', () => {
    const mid = turdSize(3, 2, 4) // t = 0.5 → 0.8 + 0.5*1.2 = 1.4
    expect(mid).toBe('1.40rem')
  })
})
