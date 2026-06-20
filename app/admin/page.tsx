import { createSupabaseServiceClient } from '@/lib/supabase/server'
import AdminPanel from './_components/AdminPanel'

export default async function AdminPage() {
  const supabase = createSupabaseServiceClient()

  const [tournamentsResult, ltResult, payoutResult, leagueSeasonsResult, leaguesResult] = await Promise.all([
    supabase.from('tournaments').select('id, name, espn_event_id, start_date, end_date').order('start_date', { ascending: false }),
    supabase.from('league_tournaments').select('id, status, tournament_id, league_season_id').order('created_at', { ascending: false }),
    supabase.from('league_tournaments').select('id, buy_in, best_player_prize, best_team_prize, side_bet'),
    supabase.from('league_seasons').select('id, league_id'),
    supabase.from('leagues').select('id, name'),
  ])

  type Tournament    = { id: string; name: string; espn_event_id: string | null; start_date: string; end_date: string }
  type LTRow         = { id: string; status: 'drafting' | 'live' | 'completed'; tournament_id: string; league_season_id: string }
  type PayoutRow     = { id: string; buy_in: number; best_player_prize: number; best_team_prize: number; side_bet: number }
  type LeagueSeasonRow = { id: string; league_id: string }
  type LeagueRow     = { id: string; name: string }

  const tournaments   = (tournamentsResult.data   ?? []) as unknown as Tournament[]
  const ltRows        = (ltResult.data            ?? []) as unknown as LTRow[]
  const payoutRows    = (payoutResult.data        ?? []) as unknown as PayoutRow[]
  const leagueSeasons = (leagueSeasonsResult.data ?? []) as unknown as LeagueSeasonRow[]
  const leagues       = (leaguesResult.data       ?? []) as unknown as LeagueRow[]

  const tournamentNameMap  = new Map(tournaments.map((t) => [t.id, t.name]))
  const leagueNameMap      = new Map(leagues.map((l) => [l.id, l.name]))
  const lsToLeagueMap      = new Map(leagueSeasons.map((ls) => [ls.id, ls.league_id]))
  const payoutMap          = new Map(payoutRows.map((p) => [p.id, p]))

  const leagueTournaments = ltRows.map((lt) => {
    const payout   = payoutMap.get(lt.id)
    const leagueId = lsToLeagueMap.get(lt.league_season_id)
    return {
      id:                lt.id,
      status:            lt.status,
      tournament_name:   tournamentNameMap.get(lt.tournament_id) ?? 'Unknown',
      league_name:       (leagueId && leagueNameMap.get(leagueId)) ?? 'Unknown',
      season_year:       null,
      buy_in:            payout?.buy_in            ?? 20,
      best_player_prize: payout?.best_player_prize ?? 50,
      best_team_prize:   payout?.best_team_prize   ?? 30,
      side_bet:          payout?.side_bet          ?? 5,
    }
  })

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
