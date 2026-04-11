/**
 * POST /api/refresh
 *
 * Public endpoint called by the leaderboard client every 30 seconds.
 * Finds all live leagues, ingests ESPN scores, and updates the DB.
 * No secret required — safe because it only reads from ESPN and writes
 * to our own DB with no destructive operations.
 */

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { runIngest } from '@/lib/ingest'

export async function POST() {
  const supabase = createSupabaseServiceClient()

  // Find all tournaments that have at least one live league
  const { data: liveTournaments } = await supabase
    .from('leagues')
    .select('tournament_id')
    .eq('status', 'live')

  if (!liveTournaments || liveTournaments.length === 0) {
    return Response.json({ ok: true, message: 'No live leagues' })
  }

  const tournamentIds = [...new Set(liveTournaments.map((l) => l.tournament_id))]
  const results = await Promise.all(tournamentIds.map((id) => runIngest(id)))

  return Response.json({ ok: true, results })
}
