import { describe, it, expect } from 'vitest'
import { isRoundUnderway, showRoundScore, upcomingRoundColumn } from '@/lib/leaderboard'

const onCourse = { thru: '7' }
const finished = { thru: 'F' }
const notOut = { thru: null }

describe('isRoundUnderway', () => {
  it('is true when anyone is on the course', () => {
    expect(isRoundUnderway([notOut, onCourse, notOut])).toBe(true)
  })

  it('is true once players have finished the round', () => {
    expect(isRoundUnderway([finished, finished])).toBe(true)
  })

  it('is false between rounds, when nobody has a thru value', () => {
    expect(isRoundUnderway([notOut, notOut])).toBe(false)
  })

  it('is false for an empty field', () => {
    expect(isRoundUnderway([])).toBe(false)
  })
})

describe('showRoundScore', () => {
  it('always shows completed earlier rounds', () => {
    expect(showRoundScore({ round: 1, currentRound: 3, roundUnderway: true, thru: null })).toBe(true)
    expect(showRoundScore({ round: 2, currentRound: 3, roundUnderway: true, thru: null })).toBe(true)
  })

  it('shows the finished round between rounds — the R3-went-blank bug', () => {
    // R3 complete, R4 not started: nobody has a thru value, but R3 must stay visible.
    expect(showRoundScore({ round: 3, currentRound: 3, roundUnderway: false, thru: null })).toBe(true)
  })

  it('hides the in-progress round for a player who has not teed off', () => {
    expect(showRoundScore({ round: 4, currentRound: 4, roundUnderway: true, thru: null })).toBe(false)
  })

  it('shows the in-progress round once the player is out', () => {
    expect(showRoundScore({ round: 4, currentRound: 4, roundUnderway: true, thru: '7' })).toBe(true)
    expect(showRoundScore({ round: 4, currentRound: 4, roundUnderway: true, thru: 'F' })).toBe(true)
  })

  it('shows everything when no round has data yet', () => {
    expect(showRoundScore({ round: 1, currentRound: null, roundUnderway: false, thru: null })).toBe(true)
  })
})

describe('upcomingRoundColumn', () => {
  it('offers the next round between rounds when tee times exist', () => {
    expect(upcomingRoundColumn({ currentRound: 3, roundUnderway: false, anyTeeTimes: true })).toBe(4)
  })

  it('offers nothing while a round is being played', () => {
    expect(upcomingRoundColumn({ currentRound: 3, roundUnderway: true, anyTeeTimes: true })).toBeNull()
  })

  it('offers nothing when ESPN has published no tee times', () => {
    // Exactly today's TOUR Championship state: R3 done, no Sunday tee times in the feed.
    expect(upcomingRoundColumn({ currentRound: 3, roundUnderway: false, anyTeeTimes: false })).toBeNull()
  })

  it('never offers a fifth round after R4', () => {
    expect(upcomingRoundColumn({ currentRound: 4, roundUnderway: false, anyTeeTimes: true })).toBeNull()
  })

  it('offers nothing before any round has data', () => {
    expect(upcomingRoundColumn({ currentRound: null, roundUnderway: false, anyTeeTimes: true })).toBeNull()
  })
})
