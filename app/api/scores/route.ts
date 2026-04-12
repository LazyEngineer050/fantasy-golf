import { NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const leagueId = req.nextUrl.searchParams.get('leagueId')
  if (!leagueId) return Response.json({ error: 'leagueId required' }, { status: 400 })

  const supabase = createSupabaseServiceClient()

  // Team scores
  const { data: teams } = await supabase
    .from('team_scores')
    .select('user_id, total_strokes, rank')
    .eq('league_id', leagueId)
    .order('rank', { ascending: true })

  // Get tournament_id, status, and player IDs for this league
  const { data: leagueRow } = await supabase
    .from('leagues')
    .select('tournament_id, status')
    .eq('id', leagueId)
    .single()

  const { data: picks } = await supabase
    .from('picks')
    .select('player_id')
    .eq('league_id', leagueId)

  const playerIds = [...new Set((picks ?? []).map((p) => p.player_id))]

  let players: unknown[] = []
  if (leagueRow && playerIds.length > 0) {
    const { data } = await supabase
      .from('player_scores')
      .select('player_id, total_strokes, today_strokes, thru, position, tee_time, r1_strokes, r2_strokes, r3_strokes, r4_strokes')
      .eq('tournament_id', leagueRow.tournament_id)
      .in('player_id', playerIds)
    players = data ?? []
  }

  return Response.json({ teams: teams ?? [], players, status: leagueRow?.status ?? null })
}
