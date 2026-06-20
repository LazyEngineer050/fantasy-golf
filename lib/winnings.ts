export interface ScoredTeam {
  user_id: string
  total_strokes: number | null
  picks: Array<{ total_strokes: number | null }>
}

export interface PayoutConfig {
  buyIn: number
  bestPlayerPrize: number
  bestTeamPrize: number
  sideBet: number
}

export const DEFAULT_PAYOUT: PayoutConfig = {
  buyIn: 20,
  bestPlayerPrize: 50,
  bestTeamPrize: 30,
  sideBet: 5,
}

export function computeWinnings(standings: ScoredTeam[], config: PayoutConfig = DEFAULT_PAYOUT): Map<string, number> {
  const w = new Map<string, number>()
  for (const s of standings) w.set(s.user_id, -config.buyIn)

  const scored = standings.filter((s) => s.total_strokes !== null)
  if (scored.length === 0) return w

  const bestTeamScore = Math.min(...scored.map((s) => s.total_strokes!))
  const worstTeamScore = Math.max(...scored.map((s) => s.total_strokes!))
  const bestTeams = scored.filter((s) => s.total_strokes === bestTeamScore)
  const worstTeams = scored.filter((s) => s.total_strokes === worstTeamScore)

  for (const t of bestTeams) w.set(t.user_id, w.get(t.user_id)! + config.bestTeamPrize / bestTeams.length)

  if (worstTeamScore !== bestTeamScore) {
    for (const t of worstTeams) w.set(t.user_id, w.get(t.user_id)! - config.sideBet / worstTeams.length)
    for (const t of bestTeams)  w.set(t.user_id, w.get(t.user_id)! + config.sideBet / bestTeams.length)
  }

  const allPicks = standings.flatMap((s) => s.picks).filter((p) => p.total_strokes !== null)
  if (allPicks.length > 0) {
    const bestPlayerScore = Math.min(...allPicks.map((p) => p.total_strokes!))
    const ownerIds = new Set(
      standings
        .filter((s) => s.picks.some((p) => p.total_strokes === bestPlayerScore))
        .map((s) => s.user_id)
    )
    for (const uid of ownerIds) w.set(uid, (w.get(uid) ?? 0) + config.bestPlayerPrize / ownerIds.size)
  }

  return w
}

export function isTurd(
  todayStrokes: number | null,
  fieldAvgToday: number | null
): boolean {
  if (todayStrokes === null || fieldAvgToday === null) return false
  return todayStrokes >= fieldAvgToday + 3 || (todayStrokes > 0 && fieldAvgToday < 0)
}

export function turdSize(todayStrokes: number, minTurd: number, maxTurd: number): string {
  const t = maxTurd === minTurd ? 1 : (todayStrokes - minTurd) / (maxTurd - minTurd)
  return `${(0.8 + t * 1.2).toFixed(2)}rem`
}
