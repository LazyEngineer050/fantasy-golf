/**
 * Pure helpers for leaderboard display state.
 *
 * The key distinction: a player with no `thru` value has either NOT TEED OFF YET
 * (round in progress) or is BETWEEN ROUNDS (previous round complete, next not
 * started). ESPN gives us the same empty `thru` in both cases, so the difference
 * has to come from the field as a whole — if nobody is on the course, no round is
 * underway and every completed score should stay visible.
 */

export interface RoundDisplayPick {
  thru: string | null
  tee_time?: string | null
}

/** True when at least one player is out on the course right now. */
export function isRoundUnderway(picks: RoundDisplayPick[]): boolean {
  return picks.some((p) => p.thru !== null)
}

/**
 * Whether a round's score should be shown for a player.
 * Hidden only while that round is being played and the player has not teed off —
 * ESPN reports a placeholder for a round in progress that hasn't started.
 */
export function showRoundScore(opts: {
  round: number
  currentRound: number | null
  roundUnderway: boolean
  thru: string | null
}): boolean {
  const { round, currentRound, roundUnderway, thru } = opts
  if (round !== currentRound) return true
  if (!roundUnderway) return true
  return thru !== null
}

/**
 * Between rounds, tee times belong to the round about to start, not the one that
 * just finished. Returns that round number when it deserves its own column.
 */
export function upcomingRoundColumn(opts: {
  currentRound: number | null
  roundUnderway: boolean
  anyTeeTimes: boolean
}): number | null {
  const { currentRound, roundUnderway, anyTeeTimes } = opts
  if (roundUnderway || !anyTeeTimes) return null
  if (currentRound === null || currentRound >= 4) return null
  return currentRound + 1
}
