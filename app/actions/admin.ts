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
  const { error } = await supabase
    .from('tournaments')
    .insert({ name, espn_event_id: espnEventId, start_date: startDate, end_date: endDate })

  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { ok: true }
}

export async function createLeague(formData: FormData) {
  const name = (formData.get('name') as string).trim()
  const tournamentId = formData.get('tournamentId') as string
  const seriesId = (formData.get('seriesId') as string) || null

  if (!name || !tournamentId) return { error: 'Name and tournament are required' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('leagues')
    .insert({ name, tournament_id: tournamentId, status: 'drafting', series_id: seriesId })

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/')
  return { ok: true }
}

export async function addLeagueMember(formData: FormData) {
  const leagueId = formData.get('leagueId') as string
  const userId = formData.get('userId') as string
  const draftPosition = parseInt(formData.get('draftPosition') as string, 10)

  if (!leagueId || !userId || isNaN(draftPosition) || draftPosition < 1) {
    return { error: 'All fields are required' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('league_members')
    .insert({ league_id: leagueId, user_id: userId, draft_position: draftPosition })

  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { ok: true }
}

export async function removeLeagueMember(leagueId: string, userId: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('league_members')
    .delete()
    .eq('league_id', leagueId)
    .eq('user_id', userId)

  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { ok: true }
}

export async function initDraft(leagueId: string) {
  const supabase = await createSupabaseServerClient()

  const { data: members } = await supabase
    .from('league_members')
    .select('user_id, draft_position')
    .eq('league_id', leagueId)
    .order('draft_position', { ascending: true })

  if (!members || members.length === 0) return { error: 'Add members before starting the draft' }

  const firstUser = members[0]

  const { error } = await supabase
    .from('draft_state')
    .upsert(
      {
        league_id: leagueId,
        round: 1,
        pick_number: 1,
        on_clock_user_id: firstUser.user_id,
        direction: 1,
        started_at: new Date().toISOString(),
      },
      { onConflict: 'league_id' }
    )

  if (error) return { error: error.message }

  await supabase.from('leagues').update({ status: 'drafting' }).eq('id', leagueId)

  revalidatePath('/admin')
  revalidatePath('/')
  return { ok: true }
}

export async function createSeries(formData: FormData) {
  const name = (formData.get('name') as string).trim()
  const yearStr = formData.get('year') as string
  const year = yearStr ? parseInt(yearStr, 10) : null

  if (!name) return { error: 'Name is required' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('series')
    .insert({ name, year: year && !isNaN(year) ? year : null })

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/')
  return { ok: true }
}

export async function assignLeagueToSeries(leagueId: string, seriesId: string | null) {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('leagues')
    .update({ series_id: seriesId || null })
    .eq('id', leagueId)

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/')
  return { ok: true }
}

export async function setLeagueStatus(leagueId: string, status: 'drafting' | 'live' | 'completed') {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('leagues')
    .update({ status })
    .eq('id', leagueId)

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/')
  return { ok: true }
}
