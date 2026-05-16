import { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types'

type DB = SupabaseClient<Database>

export async function recomputeTeamScores(
  supabase: DB,
  leagueTournamentId: string,
  tournamentId: string
) {
  const { data: picks, error: picksErr } = await supabase
    .from('picks')
    .select('user_id, player_id')
    .eq('league_tournament_id', leagueTournamentId)

  if (picksErr || !picks) throw picksErr ?? new Error('No picks found')

  const playerIds = [...new Set(picks.map((p) => p.player_id))]
  const { data: scores, error: scoresErr } = await supabase
    .from('player_scores')
    .select('player_id, total_strokes')
    .eq('tournament_id', tournamentId)
    .in('player_id', playerIds)

  if (scoresErr) throw scoresErr

  const scoreMap = new Map<string, number | null>(
    (scores ?? []).map((s) => [s.player_id, s.total_strokes])
  )

  const userTotals = new Map<string, number>()
  for (const pick of picks) {
    const strokes = scoreMap.get(pick.player_id) ?? 0
    userTotals.set(pick.user_id, (userTotals.get(pick.user_id) ?? 0) + strokes)
  }

  const sorted = [...userTotals.entries()].sort((a, b) => a[1] - b[1])
  const now = new Date().toISOString()

  const upserts = sorted.map(([userId, total], idx) => ({
    league_tournament_id: leagueTournamentId,
    user_id: userId,
    total_strokes: total,
    rank: idx + 1,
    updated_at: now,
  }))

  if (upserts.length === 0) return

  const { error: upsertErr } = await supabase
    .from('team_scores')
    .upsert(upserts, { onConflict: 'league_tournament_id,user_id' })

  if (upsertErr) throw upsertErr
}
