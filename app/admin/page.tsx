import { createSupabaseServerClient } from '@/lib/supabase/server'
import AdminPanel from './_components/AdminPanel'

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient()

  const [tournamentsResult, ltResult] = await Promise.all([
    supabase.from('tournaments').select('id, name, espn_event_id, start_date, end_date').order('start_date', { ascending: false }),
    supabase
      .from('league_tournaments')
      .select('id, status, tournament_id, league_season_id, tournaments(name), league_seasons(season_id, league_id, seasons(year), leagues(name))')
      .order('created_at', { ascending: false }),
  ])

  type Tournament = { id: string; name: string; espn_event_id: string | null; start_date: string; end_date: string }

  type LTRow = {
    id: string
    status: 'drafting' | 'live' | 'completed'
    tournaments: { name: string } | null
    league_seasons: {
      season_id: string
      league_id: string
      seasons: { year: number } | null
      leagues: { name: string } | null
    } | null
  }

  const tournaments = (tournamentsResult.data ?? []) as unknown as Tournament[]
  const ltRows = (ltResult.data ?? []) as unknown as LTRow[]

  const leagueTournaments = ltRows.map((lt) => ({
    id: lt.id,
    status: lt.status,
    tournament_name: lt.tournaments?.name ?? 'Unknown',
    league_name: lt.league_seasons?.leagues?.name ?? 'Unknown',
    season_year: lt.league_seasons?.seasons?.year ?? null,
  }))

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-5">
        <h1 className="text-2xl font-bold text-green-400">⛳ ButteryBiscuits — Admin</h1>
        <p className="text-gray-400 text-sm mt-1">System admin: manage tournaments</p>
      </div>
      <div className="max-w-3xl mx-auto p-6">
        <AdminPanel tournaments={tournaments} leagueTournaments={leagueTournaments} />
      </div>
    </div>
  )
}
