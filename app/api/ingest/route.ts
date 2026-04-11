/**
 * POST /api/ingest
 *
 * Server-side ESPN polling endpoint.
 * Call this every 30-60 seconds via a cron (Vercel, Railway, or a free cron service).
 * Protected by INGEST_SECRET header.
 *
 * What it does:
 *  1. Fetches live leaderboard from ESPN
 *  2. Upserts players into `players` table
 *  3. Upserts player statuses into `tournament_players`
 *  4. Upserts scores into `player_scores`
 *  5. Recomputes `team_scores` for all live leagues in this tournament
 */

import { NextRequest } from 'next/server'
import { fetchEspnLeaderboard } from '@/lib/espn'
import { recomputeTeamScores } from '@/lib/scoring'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  // Auth guard
  const secret = req.headers.get('x-ingest-secret')
  if (secret !== process.env.INGEST_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { tournamentId } = await req.json().catch(() => ({}))
  if (!tournamentId) {
    return Response.json({ error: 'tournamentId required' }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  // Fetch tournament to get ESPN event ID
  const { data: tournament, error: tErr } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .single()

  if (tErr || !tournament) {
    return Response.json({ error: 'Tournament not found' }, { status: 404 })
  }

  if (!tournament.espn_event_id) {
    return Response.json({ error: 'No ESPN event ID configured' }, { status: 422 })
  }

  // Fetch ESPN data
  let espnPlayers
  try {
    espnPlayers = await fetchEspnLeaderboard(tournament.espn_event_id)
  } catch (err) {
    console.error('[ingest] ESPN fetch failed:', err)
    return Response.json({ error: 'ESPN fetch failed' }, { status: 502 })
  }

  const now = new Date().toISOString()

  // Upsert players (by espn_player_id)
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

    // Upsert tournament_players status
    await supabase.from('tournament_players').upsert(
      { tournament_id: tournamentId, player_id: playerId, status: ep.status },
      { onConflict: 'tournament_id,player_id' }
    )

    // Upsert player_scores
    await supabase.from('player_scores').upsert(
      {
        tournament_id: tournamentId,
        player_id: playerId,
        total_strokes: ep.totalStrokes,
        today_strokes: ep.todayStrokes,
        thru: ep.thru,
        position: ep.position,
        r1_strokes: ep.r1Strokes,
        r2_strokes: ep.r2Strokes,
        r3_strokes: ep.r3Strokes,
        r4_strokes: ep.r4Strokes,
        updated_at: now,
      },
      { onConflict: 'tournament_id,player_id' }
    )
  }

  // Recompute team scores for all live leagues in this tournament
  const { data: liveLeagues } = await supabase
    .from('leagues')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'live')

  for (const league of liveLeagues ?? []) {
    try {
      await recomputeTeamScores(supabase, league.id, tournamentId)
    } catch (err) {
      console.error(`[ingest] recomputeTeamScores failed for league ${league.id}:`, err)
    }
  }

  return Response.json({
    ok: true,
    players: espnPlayers.length,
    leagues: liveLeagues?.length ?? 0,
    at: now,
  })
}
