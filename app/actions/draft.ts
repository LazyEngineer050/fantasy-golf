'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

/**
 * Submit a pick in the draft.
 * Validates: on-clock user, player not already picked, player status = active.
 */
export async function submitPick(leagueId: string, playerId: string) {
  const cookieStore = await cookies()
  const userId = cookieStore.get('user_id')?.value

  if (!userId) return { error: 'Not logged in' }

  const supabase = await createSupabaseServerClient()

  // 1. Load draft state
  const { data: state, error: stateErr } = await supabase
    .from('draft_state')
    .select('*')
    .eq('league_id', leagueId)
    .single()

  if (stateErr || !state) return { error: 'Draft not found' }
  if (state.on_clock_user_id !== userId) return { error: 'Not your pick' }
  if (state.round > 4) return { error: 'Draft is complete' }

  // 2. Load league to get tournament_id
  const { data: league } = await supabase
    .from('leagues')
    .select('tournament_id, status')
    .eq('id', leagueId)
    .single()

  if (!league || league.status !== 'drafting') return { error: 'League not in draft' }

  // 3. Verify player is active in this tournament
  const { data: tp } = await supabase
    .from('tournament_players')
    .select('status')
    .eq('tournament_id', league.tournament_id)
    .eq('player_id', playerId)
    .single()

  if (!tp || tp.status !== 'active') return { error: 'Player is not available' }

  // 4. Insert pick (DB trigger enforces max-4 and uniqueness)
  const { error: pickErr } = await supabase.from('picks').insert({
    league_id: leagueId,
    pick_number: state.pick_number,
    round: state.round,
    user_id: userId,
    player_id: playerId,
  })

  if (pickErr) return { error: pickErr.message }

  // 5. Advance draft state
  const { data: members } = await supabase
    .from('league_members')
    .select('user_id, draft_position')
    .eq('league_id', leagueId)
    .order('draft_position', { ascending: true })

  if (!members || members.length === 0) return { error: 'No league members' }

  const N = members.length
  const totalPicks = N * 4

  if (state.pick_number >= totalPicks) {
    // Draft complete
    await supabase
      .from('draft_state')
      .update({ round: 5, on_clock_user_id: null })
      .eq('league_id', leagueId)

    await supabase
      .from('leagues')
      .update({ status: 'live' })
      .eq('id', leagueId)
  } else {
    const nextPickNumber = state.pick_number + 1

    // Snake draft: determine current index in round
    const picksInRound = state.pick_number - (state.round - 1) * N
    const isEndOfRound = picksInRound === N

    let nextRound = state.round
    let nextDirection = state.direction
    let nextPosition: number

    if (isEndOfRound) {
      nextRound += 1
      nextDirection = state.direction * -1
      // At the turn, same edge player picks again
      nextPosition = state.direction === 1 ? N - 1 : 0
    } else {
      // Current position in draft order
      const currentMember = members.find((m) => m.user_id === state.on_clock_user_id)
      const currentPos = currentMember ? currentMember.draft_position - 1 : 0
      nextPosition = currentPos + state.direction
    }

    // Clamp to valid range
    nextPosition = Math.max(0, Math.min(N - 1, nextPosition))
    const nextUser = members[nextPosition]

    await supabase
      .from('draft_state')
      .update({
        round: nextRound,
        pick_number: nextPickNumber,
        on_clock_user_id: nextUser.user_id,
        direction: nextDirection,
      })
      .eq('league_id', leagueId)
  }

  revalidatePath(`/draft/${leagueId}`)
  return { ok: true }
}

/** Set display name and store user_id cookie (simple auth) */
export async function loginOrRegister(displayName: string) {
  const supabase = await createSupabaseServerClient()
  const cookieStore = await cookies()

  // Reuse existing session if cookie present
  const existingId = cookieStore.get('user_id')?.value
  if (existingId) {
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('id', existingId)
      .maybeSingle()
    if (data) return { userId: existingId }
  }

  const trimmed = displayName.trim().slice(0, 40)
  if (!trimmed) return { error: 'Display name required' }

  const { data: user, error } = await supabase
    .from('users')
    .insert({ display_name: trimmed })
    .select('id')
    .single()

  if (error || !user) return { error: 'Failed to create user' }

  cookieStore.set('user_id', user.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })

  return { userId: user.id }
}
