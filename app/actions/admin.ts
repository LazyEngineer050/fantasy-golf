'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createTournament(formData: FormData) {
  const name = (formData.get('name') as string).trim()
  const espnEventId = (formData.get('espnEventId') as string).trim() || null
  const startDate = formData.get('startDate') as string
  const endDate = formData.get('endDate') as string

  if (!name || !startDate || !endDate) return { error: 'Name, start date, and end date are required' }

  const supabase = await createSupabaseServerClient()

  // Auto-assign to season based on year
  const year = new Date(startDate + 'T12:00:00Z').getFullYear()
  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('year', year)
    .maybeSingle()

  const seasonId = season?.id ?? null

  const { error } = await supabase
    .from('tournaments')
    .insert({ name, espn_event_id: espnEventId, start_date: startDate, end_date: endDate, season_id: seasonId })

  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { ok: true }
}

export async function updateTournament(tournamentId: string, formData: FormData) {
  const name       = (formData.get('name') as string).trim()
  const espnEventId = (formData.get('espnEventId') as string).trim() || null
  const startDate  = formData.get('startDate') as string
  const endDate    = formData.get('endDate') as string

  if (!name || !startDate || !endDate) return { error: 'Name, start date, and end date are required' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('tournaments')
    .update({ name, espn_event_id: espnEventId, start_date: startDate, end_date: endDate })
    .eq('id', tournamentId)

  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { ok: true }
}

export async function setLeagueTournamentStatus(leagueTournamentId: string, status: 'drafting' | 'live' | 'completed') {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('league_tournaments')
    .update({ status })
    .eq('id', leagueTournamentId)

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/')
  return { ok: true }
}

export async function updatePayoutConfig(leagueTournamentId: string, formData: FormData) {
  const buyIn          = parseInt(formData.get('buy_in') as string, 10)
  const bestPlayerPrize = parseInt(formData.get('best_player_prize') as string, 10)
  const bestTeamPrize  = parseInt(formData.get('best_team_prize') as string, 10)
  const sideBet        = parseInt(formData.get('side_bet') as string, 10)

  if ([buyIn, bestPlayerPrize, bestTeamPrize, sideBet].some(isNaN)) return { error: 'All values must be numbers' }
  if ([buyIn, bestPlayerPrize, bestTeamPrize, sideBet].some((v) => v < 0)) return { error: 'Values cannot be negative' }

  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('league_tournaments')
    .update({ buy_in: buyIn, best_player_prize: bestPlayerPrize, best_team_prize: bestTeamPrize, side_bet: sideBet })
    .eq('id', leagueTournamentId)

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/standings')
  return { ok: true }
}
