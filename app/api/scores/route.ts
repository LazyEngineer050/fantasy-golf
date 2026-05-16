import { NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const leagueTournamentId = req.nextUrl.searchParams.get('leagueTournamentId')
  if (!leagueTournamentId) return Response.json({ error: 'leagueTournamentId required' }, { status: 400 })

  const supabase = createSupabaseServiceClient()

  const { data: teams } = await supabase
    .from('team_scores')
    .select('user_id, total_strokes, rank')
    .eq('league_tournament_id', leagueTournamentId)
    .order('rank', { ascending: true })

  const { data: ltRow } = await supabase
    .from('league_tournaments')
    .select('tournament_id, status')
    .eq('id', leagueTournamentId)
    .single()

  const { data: picks } = await supabase
    .from('picks')
    .select('player_id')
    .eq('league_tournament_id', leagueTournamentId)

  const playerIds = [...new Set((picks ?? []).map((p) => p.player_id))]

  let players: unknown[] = []
  if (ltRow && playerIds.length > 0) {
    const { data } = await supabase
      .from('player_scores')
      .select('player_id, total_strokes, today_strokes, thru, position, tee_time, r1_strokes, r2_strokes, r3_strokes, r4_strokes')
      .eq('tournament_id', ltRow.tournament_id)
      .in('player_id', playerIds)
    players = data ?? []
  }

  return Response.json({ teams: teams ?? [], players, status: ltRow?.status ?? null })
}
