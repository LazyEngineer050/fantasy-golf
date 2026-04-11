'use server'

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export interface CutPlayer {
  espnPlayerId: string
  name: string
  madeCut: boolean
  position: string | null
  totalStrokes: number | null
  thru: string | null
}

export interface TeamInput {
  name: string
  players: CutPlayer[]
}

export async function saveDraft(
  leagueId: string,
  tournamentId: string,
  teams: TeamInput[]
) {
  if (!leagueId || !tournamentId) return { error: 'League and tournament are required' }
  if (teams.length === 0) return { error: 'Add at least one team' }
  if (teams.some((t) => !t.name.trim())) return { error: 'All teams need a name' }
  if (teams.some((t) => t.players.length === 0)) return { error: 'All teams need at least one player' }
  if (teams.some((t) => t.players.length > 4)) return { error: 'Max 4 players per team' }

  const supabase = createSupabaseServiceClient()

  // Determine starting pick number (in case league already has some picks)
  const { data: existingPicks } = await supabase
    .from('picks')
    .select('pick_number')
    .eq('league_id', leagueId)
    .order('pick_number', { ascending: false })
    .limit(1)

  let globalPickNumber = existingPicks && existingPicks.length > 0
    ? (existingPicks[0].pick_number as number) + 1
    : 1

  // Determine starting draft position
  const { data: existingMembers } = await supabase
    .from('league_members')
    .select('draft_position')
    .eq('league_id', leagueId)
    .order('draft_position', { ascending: false })
    .limit(1)

  let nextPosition = existingMembers && existingMembers.length > 0
    ? (existingMembers[0].draft_position as number) + 1
    : 1

  for (const team of teams) {
    // 1. Upsert each player into the global players table & tournament_players
    const playerDbIds: string[] = []

    for (const player of team.players) {
      // Find or create player record
      const { data: existing } = await supabase
        .from('players')
        .select('id')
        .eq('espn_player_id', player.espnPlayerId)
        .maybeSingle()

      let playerId: string
      if (existing) {
        playerId = existing.id
      } else {
        const { data: inserted, error } = await supabase
          .from('players')
          .insert({ name: player.name, espn_player_id: player.espnPlayerId })
          .select('id')
          .single()
        if (error || !inserted) return { error: `Failed to save player ${player.name}: ${error?.message}` }
        playerId = inserted.id
      }

      // Upsert into tournament_players with correct cut status
      await supabase.from('tournament_players').upsert(
        { tournament_id: tournamentId, player_id: playerId, status: player.madeCut ? 'active' : 'cut' },
        { onConflict: 'tournament_id,player_id' }
      )

      playerDbIds.push(playerId)
    }

    // 2. Create a user for the team
    const { data: user, error: userErr } = await supabase
      .from('users')
      .insert({ display_name: team.name.trim() })
      .select('id')
      .single()

    if (userErr || !user) return { error: `Failed to create team "${team.name}": ${userErr?.message}` }

    // 3. Add to league as a member
    const { error: memberErr } = await supabase
      .from('league_members')
      .insert({ league_id: leagueId, user_id: user.id, draft_position: nextPosition++ })

    if (memberErr) return { error: `Failed to add "${team.name}" to league: ${memberErr.message}` }

    // 4. Create picks — one per player, round 1–4
    for (let i = 0; i < playerDbIds.length; i++) {
      const { error: pickErr } = await supabase.from('picks').insert({
        league_id: leagueId,
        pick_number: globalPickNumber++,
        round: i + 1,
        user_id: user.id,
        player_id: playerDbIds[i],
      })
      if (pickErr) return { error: `Failed to record pick: ${pickErr.message}` }
    }
  }

  // Mark league as live and draft complete
  await supabase.from('leagues').update({ status: 'live' }).eq('id', leagueId)
  await supabase.from('draft_state').upsert(
    { league_id: leagueId, round: 5, pick_number: globalPickNumber, on_clock_user_id: null, direction: 1 },
    { onConflict: 'league_id' }
  )

  revalidatePath('/')
  revalidatePath('/commissioner')
  revalidatePath(`/dashboard/${leagueId}`)

  return { ok: true }
}

// ─── Helpers shared by management actions ────────────────────────────────────

async function upsertPlayer(supabase: ReturnType<typeof createSupabaseServiceClient>, player: CutPlayer, tournamentId: string): Promise<{ id: string } | { error: string }> {
  const { data: existing } = await supabase
    .from('players')
    .select('id')
    .eq('espn_player_id', player.espnPlayerId)
    .maybeSingle()

  if (existing) {
    await supabase.from('tournament_players').upsert(
      { tournament_id: tournamentId, player_id: existing.id, status: player.madeCut ? 'active' : 'cut' },
      { onConflict: 'tournament_id,player_id' }
    )
    return { id: existing.id }
  }

  const { data: inserted, error } = await supabase
    .from('players')
    .insert({ name: player.name, espn_player_id: player.espnPlayerId })
    .select('id')
    .single()

  if (error || !inserted) return { error: `Failed to save player: ${error?.message}` }

  await supabase.from('tournament_players').upsert(
    { tournament_id: tournamentId, player_id: inserted.id, status: player.madeCut ? 'active' : 'cut' },
    { onConflict: 'tournament_id,player_id' }
  )
  return { id: inserted.id }
}

// ─── Team management ─────────────────────────────────────────────────────────

export async function deleteTeam(leagueId: string, userId: string) {
  const supabase = createSupabaseServiceClient()

  const { error: pickErr } = await supabase
    .from('picks')
    .delete()
    .eq('league_id', leagueId)
    .eq('user_id', userId)

  if (pickErr) return { error: pickErr.message }

  const { error: memberErr } = await supabase
    .from('league_members')
    .delete()
    .eq('league_id', leagueId)
    .eq('user_id', userId)

  if (memberErr) return { error: memberErr.message }

  revalidatePath('/commissioner')
  revalidatePath(`/dashboard/${leagueId}`)
  revalidatePath('/')
  return { ok: true }
}

export async function removePlayerPick(leagueId: string, pickId: string) {
  const supabase = createSupabaseServiceClient()

  const { error } = await supabase.from('picks').delete().eq('id', pickId)

  if (error) return { error: error.message }

  revalidatePath('/commissioner')
  revalidatePath(`/dashboard/${leagueId}`)
  return { ok: true }
}

export async function addPlayerToTeam(
  leagueId: string,
  userId: string,
  tournamentId: string,
  player: CutPlayer
) {
  const supabase = createSupabaseServiceClient()

  const result = await upsertPlayer(supabase, player, tournamentId)
  if ('error' in result) return result

  // Next pick_number for this league
  const { data: maxPick } = await supabase
    .from('picks')
    .select('pick_number')
    .eq('league_id', leagueId)
    .order('pick_number', { ascending: false })
    .limit(1)

  const nextPickNumber = maxPick && maxPick.length > 0 ? (maxPick[0].pick_number as number) + 1 : 1

  // Next round for this user (how many picks they already have + 1)
  const { data: userPicks } = await supabase
    .from('picks')
    .select('round')
    .eq('league_id', leagueId)
    .eq('user_id', userId)

  const nextRound = (userPicks?.length ?? 0) + 1

  const { error } = await supabase.from('picks').insert({
    league_id: leagueId,
    pick_number: nextPickNumber,
    round: nextRound,
    user_id: userId,
    player_id: result.id,
  })

  if (error) return { error: error.message }

  revalidatePath('/commissioner')
  revalidatePath(`/dashboard/${leagueId}`)
  return { ok: true }
}

export async function renameTeam(leagueId: string, userId: string, newName: string) {
  const supabase = createSupabaseServiceClient()
  const trimmed = newName.trim().slice(0, 40)
  if (!trimmed) return { error: 'Name required' }

  const { error } = await supabase
    .from('users')
    .update({ display_name: trimmed })
    .eq('id', userId)

  if (error) return { error: error.message }

  revalidatePath('/commissioner')
  revalidatePath(`/dashboard/${leagueId}`)
  return { ok: true }
}
