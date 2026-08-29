/**
 * POST /api/refresh
 * Public endpoint called by the leaderboard client every 30 seconds.
 *
 * Optional JSON body:
 *   { scoreboard?: unknown, tournamentId?: string }
 *
 * `scoreboard` is a raw ESPN payload the caller's browser fetched itself. It is
 * used ONLY as a fallback when this server cannot reach ESPN (Vercel's egress to
 * site.api.espn.com is currently blocked), and only when its event id matches the
 * tournament's `espn_event_id`. `tournamentId` targets a specific tournament —
 * restricted to tournaments that are drafting or live, so completed results can
 * never be rewritten.
 */

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { runIngest } from '@/lib/ingest'

export async function POST(req: Request) {
  const supabase = createSupabaseServiceClient()

  const body = await req.json().catch(() => ({}))
  const scoreboard = (body as { scoreboard?: unknown })?.scoreboard
  const requestedTournamentId = (body as { tournamentId?: string })?.tournamentId

  // Tournaments open to ingestion: those with a drafting or live league_tournament.
  const { data: openLTs } = await supabase
    .from('league_tournaments')
    .select('tournament_id, status')
    .in('status', ['drafting', 'live'])

  if (!openLTs || openLTs.length === 0) {
    return Response.json({ ok: true, message: 'No live league tournaments' })
  }

  const openTournamentIds = new Set(openLTs.map((lt) => lt.tournament_id))

  let tournamentIds: string[]
  if (requestedTournamentId) {
    if (!openTournamentIds.has(requestedTournamentId)) {
      return Response.json({ error: 'Tournament is not drafting or live' }, { status: 403 })
    }
    tournamentIds = [requestedTournamentId]
  } else {
    tournamentIds = [...openTournamentIds]
  }

  const results = await Promise.all(tournamentIds.map((id) => runIngest(id, { scoreboard })))

  return Response.json({ ok: true, results })
}
