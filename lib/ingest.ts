import { fetchEspnLeaderboard } from '@/lib/espn'
import { recomputeTeamScores } from '@/lib/scoring'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export async function runIngest(tournamentId: string): Promise<{ ok: true; players: number; leagueTournaments: number; at: string } | { error: string }> {
  const supabase = createSupabaseServiceClient()

  const { data: tournament, error: tErr } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .single()

  if (tErr || !tournament) return { error: 'Tournament not found' }
  if (!tournament.espn_event_id) return { error: 'No ESPN event ID configured' }

  let espnPlayers
  try {
    espnPlayers = await fetchEspnLeaderboard(tournament.espn_event_id)
  } catch {
    return { error: 'ESPN fetch failed' }
  }

  const now = new Date().toISOString()

  for (const ep of espnPlayers) {
    const { data: existing } = await supabase
      .from('players')
      .select('id')
      .eq('espn_player_id', ep.espnPlayerId)
      .maybeSingle()

    let playerId: string
    if (existing) {
      playerId = existing.id
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from('players')
        .insert({ name: ep.name, espn_player_id: ep.espnPlayerId })
        .select('id')
        .single()
      if (insertErr || !inserted) continue
      playerId = inserted.id
    }

    await supabase.from('tournament_players').upsert(
      { tournament_id: tournamentId, player_id: playerId, status: ep.status },
      { onConflict: 'tournament_id,player_id' }
    )

    await supabase.from('player_scores').upsert(
      {
        tournament_id: tournamentId,
        player_id: playerId,
        total_strokes: ep.totalStrokes,
        today_strokes: ep.todayStrokes,
        thru: ep.thru,
        position: ep.position,
        tee_time: ep.teeTime,
        r1_strokes: ep.r1Strokes,
        r2_strokes: ep.r2Strokes,
        r3_strokes: ep.r3Strokes,
        r4_strokes: ep.r4Strokes,
        updated_at: now,
      },
      { onConflict: 'tournament_id,player_id' }
    )
  }

  // Find live league_tournaments for this tournament
  const { data: liveLTs } = await supabase
    .from('league_tournaments')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'live')

  for (const lt of liveLTs ?? []) {
    try {
      await recomputeTeamScores(supabase, lt.id, tournamentId)
    } catch (err) {
      console.error(`[ingest] recomputeTeamScores failed for league_tournament ${lt.id}:`, err)
    }
  }

  // Auto-complete: if every active player finished, mark league_tournaments completed
  const { data: activePlayers } = await supabase
    .from('tournament_players')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'active')

  if (activePlayers && activePlayers.length > 0) {
    const activeIds = activePlayers.map((p) => p.player_id)
    const { data: activeScores } = await supabase
      .from('player_scores')
      .select('thru, r4_strokes')
      .eq('tournament_id', tournamentId)
      .in('player_id', activeIds)

    const allFinished =
      activeScores != null &&
      activeScores.length > 0 &&
      activeScores.every((s) => s.thru === 'F' && s.r4_strokes !== null)

    if (allFinished && (liveLTs?.length ?? 0) > 0) {
      await supabase
        .from('league_tournaments')
        .update({ status: 'completed' })
        .eq('tournament_id', tournamentId)
        .eq('status', 'live')
      console.log(`[ingest] Tournament ${tournamentId} complete — league_tournaments marked completed`)
    }
  }

  return { ok: true, players: espnPlayers.length, leagueTournaments: liveLTs?.length ?? 0, at: now }
}
