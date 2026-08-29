/**
 * GET /api/draft-pool?leagueTournamentId=…
 * Undrafted players for a draft room, read from the last ESPN ingest.
 * Used by the draft board to reload the pool after a client-assisted ingest.
 */

import { NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import type { AvailablePlayer } from '@/lib/types'

export async function GET(req: NextRequest) {
  const leagueTournamentId = req.nextUrl.searchParams.get('leagueTournamentId')
  if (!leagueTournamentId) {
    return Response.json({ error: 'leagueTournamentId required' }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  const { data: lt } = await supabase
    .from('league_tournaments')
    .select('tournament_id')
    .eq('id', leagueTournamentId)
    .single()

  if (!lt) return Response.json({ error: 'League tournament not found' }, { status: 404 })

  const tournamentId = lt.tournament_id

  // Never use PostgREST joins on picks — always separate queries.
  const [{ data: picksRaw }, { data: scoresRaw }] = await Promise.all([
    supabase.from('picks').select('player_id').eq('league_tournament_id', leagueTournamentId),
    supabase
      .from('player_scores')
      .select('player_id, total_strokes, position, thru')
      .eq('tournament_id', tournamentId),
  ])

  type ScoreRow = { player_id: string; total_strokes: number | null; position: string | null; thru: string | null }
  const drafted = new Set(((picksRaw ?? []) as { player_id: string }[]).map((p) => p.player_id))
  const scores = (scoresRaw ?? []) as unknown as ScoreRow[]
  const playerIds = scores.map((s) => s.player_id)

  if (playerIds.length === 0) return Response.json({ players: [] })

  const [{ data: playersRaw }, { data: tpRaw }] = await Promise.all([
    supabase.from('players').select('id, name, espn_player_id').in('id', playerIds),
    supabase
      .from('tournament_players')
      .select('player_id, status')
      .eq('tournament_id', tournamentId)
      .in('player_id', playerIds),
  ])

  type PlayerRow = { id: string; name: string; espn_player_id: string | null }
  type TPRow = { player_id: string; status: 'active' | 'cut' | 'wd' }
  const playerMap = new Map(((playersRaw ?? []) as unknown as PlayerRow[]).map((p) => [p.id, p]))
  const statusMap = new Map(((tpRaw ?? []) as unknown as TPRow[]).map((t) => [t.player_id, t.status]))

  const players: AvailablePlayer[] = scores
    .filter((s) => playerMap.has(s.player_id) && !drafted.has(s.player_id))
    .sort((a, b) => (a.total_strokes ?? 999) - (b.total_strokes ?? 999))
    .map((s) => {
      const p = playerMap.get(s.player_id)!
      return {
        id: s.player_id,
        name: p.name,
        espn_player_id: p.espn_player_id ?? null,
        status: statusMap.get(s.player_id) ?? 'active',
        total_strokes: s.total_strokes,
        position: s.position,
        thru: s.thru,
      }
    })

  return Response.json({ players })
}
