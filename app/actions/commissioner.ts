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

// ─── League management ────────────────────────────────────────────────────────

export async function createLeague(formData: FormData) {
  const name = (formData.get('name') as string).trim()
  if (!name) return { error: 'League name is required' }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('leagues').insert({ name })
  if (error) return { error: error.message }

  revalidatePath('/commissioner')
  return { ok: true }
}

// ─── League season + member management ───────────────────────────────────────

/**
 * Ensures a league_season exists for the given league + season.
 * If it doesn't exist, creates it and copies members from the most recent
 * prior league_season for that league (if any).
 */
export async function ensureLeagueSeason(leagueId: string, seasonId: string): Promise<{ id: string } | { error: string }> {
  const supabase = createSupabaseServiceClient()

  // Check if already exists
  const { data: existing } = await supabase
    .from('league_seasons')
    .select('id')
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .maybeSingle()

  if (existing) return { id: existing.id }

  // Create new league_season
  const { data: created, error: createErr } = await supabase
    .from('league_seasons')
    .insert({ league_id: leagueId, season_id: seasonId })
    .select('id')
    .single()

  if (createErr || !created) return { error: createErr?.message ?? 'Failed to create league season' }

  // Copy members from most recent prior league_season for this league
  const { data: priorLS } = await supabase
    .from('league_seasons')
    .select('id')
    .eq('league_id', leagueId)
    .neq('id', created.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (priorLS) {
    const { data: priorMembers } = await supabase
      .from('league_season_members')
      .select('user_id, draft_position')
      .eq('league_season_id', priorLS.id)

    if (priorMembers && priorMembers.length > 0) {
      await supabase.from('league_season_members').insert(
        priorMembers.map((m) => ({
          league_season_id: created.id,
          user_id: m.user_id,
          draft_position: m.draft_position,
        }))
      )
    }
  }

  revalidatePath('/commissioner')
  return { id: created.id }
}

export async function addLeagueSeasonMember(formData: FormData) {
  const leagueSeasonId = formData.get('leagueSeasonId') as string
  const userId = formData.get('userId') as string
  const draftPosition = parseInt(formData.get('draftPosition') as string, 10)

  if (!leagueSeasonId || !userId || isNaN(draftPosition)) return { error: 'All fields required' }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('league_season_members')
    .insert({ league_season_id: leagueSeasonId, user_id: userId, draft_position: draftPosition })

  if (error) return { error: error.message }
  revalidatePath('/commissioner')
  return { ok: true }
}

export async function removeLeagueSeasonMember(leagueSeasonId: string, userId: string) {
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('league_season_members')
    .delete()
    .eq('league_season_id', leagueSeasonId)
    .eq('user_id', userId)

  if (error) return { error: error.message }
  revalidatePath('/commissioner')
  return { ok: true }
}

export async function createUser(displayName: string): Promise<{ id: string } | { error: string }> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('users')
    .insert({ display_name: displayName.trim() })
    .select('id')
    .single()

  if (error || !data) return { error: error?.message ?? 'Failed to create user' }
  return { id: data.id }
}

// ─── Draft ────────────────────────────────────────────────────────────────────

/**
 * Save a completed offline draft.
 * picks: { userId, players: CutPlayer[] }[]
 * Creates a league_tournament (if needed) and inserts all picks.
 */
export async function saveDraft(
  leagueSeasonId: string,
  tournamentId: string | null,
  picks: { userId: string; players: CutPlayer[] }[],
  espnEvent?: { eventId: string; name: string; startDate: string | null }
) {
  if (!leagueSeasonId) return { error: 'League season is required' }
  if (picks.length === 0) return { error: 'No picks provided' }
  if (picks.some((p) => p.players.length === 0)) return { error: 'All members need at least one player' }

  const supabase = createSupabaseServiceClient()

  // Resolve tournament ID — find existing by espn_event_id or create on the fly
  if (!tournamentId && espnEvent) {
    const { data: existing } = await supabase
      .from('tournaments')
      .select('id')
      .eq('espn_event_id', espnEvent.eventId)
      .maybeSingle()

    if (existing) {
      tournamentId = existing.id
    } else {
      const startDate = espnEvent.startDate ?? new Date().toISOString().slice(0, 10)
      // end_date = startDate + 3 days (standard 4-day tournament)
      const endDate = new Date(new Date(startDate + 'T12:00:00Z').getTime() + 3 * 86400000).toISOString().slice(0, 10)
      const year = new Date(startDate + 'T12:00:00Z').getFullYear()
      const { data: season } = await supabase.from('seasons').select('id').eq('year', year).maybeSingle()
      const { data: created, error: tErr } = await supabase
        .from('tournaments')
        .insert({ name: espnEvent.name, espn_event_id: espnEvent.eventId, start_date: startDate, end_date: endDate, season_id: season?.id ?? null })
        .select('id')
        .single()
      if (tErr || !created) return { error: tErr?.message ?? 'Failed to create tournament' }
      tournamentId = created.id
    }
  }

  if (!tournamentId) return { error: 'No tournament selected' }

  // Create or reuse league_tournament
  const { data: existingLT } = await supabase
    .from('league_tournaments')
    .select('id')
    .eq('league_season_id', leagueSeasonId)
    .eq('tournament_id', tournamentId)
    .maybeSingle()

  let leagueTournamentId: string

  if (existingLT) {
    leagueTournamentId = existingLT.id
    // Clear existing picks so we can re-save
    await supabase.from('picks').delete().eq('league_tournament_id', leagueTournamentId)
    await supabase.from('team_scores').delete().eq('league_tournament_id', leagueTournamentId)
  } else {
    const { data: created, error: ltErr } = await supabase
      .from('league_tournaments')
      .insert({ league_season_id: leagueSeasonId, tournament_id: tournamentId, status: 'drafting' })
      .select('id')
      .single()

    if (ltErr || !created) return { error: ltErr?.message ?? 'Failed to create league tournament' }
    leagueTournamentId = created.id
  }

  let globalPickNumber = 1

  for (const { userId, players } of picks) {
    for (let i = 0; i < players.length; i++) {
      const player = players[i]

      // Find or create player record
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('id')
        .eq('espn_player_id', player.espnPlayerId)
        .maybeSingle()

      let playerId: string
      if (existingPlayer) {
        playerId = existingPlayer.id
      } else {
        const { data: inserted, error } = await supabase
          .from('players')
          .insert({ name: player.name, espn_player_id: player.espnPlayerId })
          .select('id')
          .single()
        if (error || !inserted) return { error: `Failed to save player ${player.name}` }
        playerId = inserted.id
      }

      // Upsert tournament_players
      await supabase.from('tournament_players').upsert(
        { tournament_id: tournamentId, player_id: playerId, status: player.madeCut ? 'active' : 'cut' },
        { onConflict: 'tournament_id,player_id' }
      )

      // Insert pick
      const { error: pickErr } = await supabase.from('picks').insert({
        league_tournament_id: leagueTournamentId,
        pick_number: globalPickNumber++,
        round: i + 1,
        user_id: userId,
        player_id: playerId,
      })
      if (pickErr) return { error: `Failed to record pick: ${pickErr.message}` }
    }
  }

  // Mark live
  await supabase
    .from('league_tournaments')
    .update({ status: 'live' })
    .eq('id', leagueTournamentId)

  revalidatePath('/')
  revalidatePath('/commissioner')
  revalidatePath(`/dashboard/${leagueTournamentId}`)

  return { ok: true, leagueTournamentId }
}

// ─── Pick management ──────────────────────────────────────────────────────────

export async function removePlayerPick(leagueTournamentId: string, pickId: string) {
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('picks').delete().eq('id', pickId)
  if (error) return { error: error.message }
  revalidatePath('/commissioner')
  revalidatePath(`/dashboard/${leagueTournamentId}`)
  return { ok: true }
}

export async function addPlayerToTeam(
  leagueTournamentId: string,
  tournamentId: string,
  userId: string,
  player: CutPlayer
) {
  const supabase = createSupabaseServiceClient()

  const { data: existingPlayer } = await supabase
    .from('players')
    .select('id')
    .eq('espn_player_id', player.espnPlayerId)
    .maybeSingle()

  let playerId: string
  if (existingPlayer) {
    playerId = existingPlayer.id
  } else {
    const { data: inserted, error } = await supabase
      .from('players')
      .insert({ name: player.name, espn_player_id: player.espnPlayerId })
      .select('id')
      .single()
    if (error || !inserted) return { error: `Failed to save player` }
    playerId = inserted.id
  }

  await supabase.from('tournament_players').upsert(
    { tournament_id: tournamentId, player_id: playerId, status: player.madeCut ? 'active' : 'cut' },
    { onConflict: 'tournament_id,player_id' }
  )

  const { data: maxPick } = await supabase
    .from('picks')
    .select('pick_number')
    .eq('league_tournament_id', leagueTournamentId)
    .order('pick_number', { ascending: false })
    .limit(1)

  const nextPickNumber = maxPick && maxPick.length > 0 ? (maxPick[0].pick_number as number) + 1 : 1

  const { data: userPicks } = await supabase
    .from('picks')
    .select('round')
    .eq('league_tournament_id', leagueTournamentId)
    .eq('user_id', userId)

  const nextRound = (userPicks?.length ?? 0) + 1

  const { error } = await supabase.from('picks').insert({
    league_tournament_id: leagueTournamentId,
    pick_number: nextPickNumber,
    round: nextRound,
    user_id: userId,
    player_id: playerId,
  })

  if (error) return { error: error.message }
  revalidatePath('/commissioner')
  revalidatePath(`/dashboard/${leagueTournamentId}`)
  return { ok: true }
}

export async function renameTeam(userId: string, newName: string) {
  const supabase = createSupabaseServiceClient()
  const trimmed = newName.trim().slice(0, 40)
  if (!trimmed) return { error: 'Name required' }
  const { error } = await supabase.from('users').update({ display_name: trimmed }).eq('id', userId)
  if (error) return { error: error.message }
  revalidatePath('/commissioner')
  return { ok: true }
}

export async function completeLeagueTournament(leagueTournamentId: string) {
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('league_tournaments')
    .update({ status: 'completed' })
    .eq('id', leagueTournamentId)

  if (error) return { error: error.message }
  revalidatePath('/commissioner')
  revalidatePath(`/dashboard/${leagueTournamentId}`)
  revalidatePath('/')
  return { ok: true }
}
