import { createSupabaseServiceClient } from '@/lib/supabase/server'
import AdminPanel from './_components/AdminPanel'

export default async function AdminPage() {
  const supabase = createSupabaseServiceClient()

  const [tournamentsResult, ltResult, payoutResult] = await Promise.all([
    supabase.from('tournaments').select('id, name, espn_event_id, start_date, end_date').order('start_date', { ascending: false }),
    supabase.from('league_tournaments').select('id, status'),
    supabase.from('league_tournaments').select('id, buy_in, best_player_prize, best_team_prize, side_bet'),
  ])

  type Tournament = { id: string; name: string; espn_event_id: string | null; start_date: string; end_date: string }

  type LTRow = { id: string; status: 'drafting' | 'live' | 'completed' }

  type PayoutRow = { id: string; buy_in: number; best_player_prize: number; best_team_prize: number; side_bet: number }

  const tournaments = (tournamentsResult.data ?? []) as unknown as Tournament[]
  const ltRows = (ltResult.data ?? []) as unknown as LTRow[]
  const payoutMap = new Map(
    ((payoutResult.data ?? []) as unknown as PayoutRow[]).map((p) => [p.id, p])
  )

  const leagueTournaments = ltRows.map((lt) => {
    const payout = payoutMap.get(lt.id)
    return {
      id: lt.id,
      status: lt.status,
      tournament_name: 'Tournament',
      league_name: 'League',
      season_year: null,
      buy_in: payout?.buy_in ?? 20,
      best_player_prize: payout?.best_player_prize ?? 50,
      best_team_prize: payout?.best_team_prize ?? 30,
      side_bet: payout?.side_bet ?? 5,
    }
  })

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-5">
        <h1 className="text-2xl font-bold text-green-400">⛳ ButteryBiscuits — Admin</h1>
        <p className="text-gray-400 text-sm mt-1">System admin: manage tournaments</p>
      </div>
      <div className="max-w-3xl mx-auto p-6">
        <div className="mb-4 bg-gray-800 rounded-lg p-3 text-xs text-gray-400 font-mono space-y-1">
          <p>league_tournaments rows: {ltRows.length}</p>
          <p>ltResult.error: {ltResult.error ? JSON.stringify(ltResult.error) : 'none'}</p>
          <p>payoutResult.error: {payoutResult.error ? JSON.stringify(payoutResult.error) : 'none'}</p>
        </div>
        <AdminPanel tournaments={tournaments} leagueTournaments={leagueTournaments} />
      </div>
    </div>
  )
}
