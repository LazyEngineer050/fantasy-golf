/**
 * POST /api/refresh
 * Public endpoint called by the leaderboard client every 30 seconds.
 */

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { runIngest } from '@/lib/ingest'

export async function POST() {
  const supabase = createSupabaseServiceClient()

  // Find all tournaments that have at least one live league_tournament
  const { data: liveLTs } = await supabase
    .from('league_tournaments')
    .select('tournament_id')
    .eq('status', 'live')

  if (!liveLTs || liveLTs.length === 0) {
    return Response.json({ ok: true, message: 'No live league tournaments' })
  }

  const tournamentIds = [...new Set(liveLTs.map((lt) => lt.tournament_id))]
  const results = await Promise.all(tournamentIds.map((id) => runIngest(id)))

  return Response.json({ ok: true, results })
}
