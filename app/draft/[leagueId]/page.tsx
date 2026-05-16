import { createSupabaseServerClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import DraftBoard from './_components/DraftBoard'
import type { AvailablePlayer, DraftStateWithMembers, PickWithPlayer } from '@/lib/types'

interface PageProps {
  params: Promise<{ leagueId: string }>
}

export default async function DraftPage({ params }: PageProps) {
  // Note: leagueId param holds a league_tournament_id
  const { leagueId: leagueTournamentId } = await params
  const cookieStore = await cookies()
  const userId = cookieStore.get('user_id')?.value ?? null

  const supabase = await createSupabaseServerClient()

  // Load league_tournament
  const { data: ltRaw } = await supabase
    .from('league_tournaments')
    .select('id, status, tournament_id, league_season_id, tournaments(*), league_seasons(leagues(name))')
    .eq('id', leagueTournamentId)
    .single()

  if (!ltRaw) notFound()

  const lt = ltRaw as unknown as {
    id: string
    status: 'drafting' | 'live' | 'completed'
    tournament_id: string
    league_season_id: string
    tournaments: { id: string; name: string; espn_event_id: string | null } | null
    league_seasons: { leagues: { name: string } | null } | null
  }

  const tournamentId: string = lt.tournaments?.id ?? lt.tournament_id
  const leagueName = lt.league_seasons?.leagues?.name ?? 'ButteryBiscuits'

  // Load draft state
  const { data: stateRaw } = await supabase
    .from('draft_state')
    .select('*')
    .eq('league_tournament_id', leagueTournamentId)
    .single()

  // Load members via league_season_members
  const { data: membersRaw } = await supabase
    .from('league_season_members')
    .select('user_id, draft_position, users(display_name)')
    .eq('league_season_id', lt.league_season_id)
    .order('draft_position', { ascending: true })

  const members = (membersRaw ?? []).map((m: any) => ({
    user_id: m.user_id,
    draft_position: m.draft_position,
    display_name: m.users?.display_name ?? 'Unknown',
  }))

  const typedState = stateRaw as unknown as {
    league_tournament_id: string; round: number; pick_number: number
    on_clock_user_id: string | null; direction: number; started_at: string
  } | null

  const draftState: DraftStateWithMembers | null = typedState
    ? { ...typedState, members }
    : null

  // Load existing picks
  const { data: picksRaw } = await supabase
    .from('picks')
    .select('id, pick_number, round, user_id, player_id')
    .eq('league_tournament_id', leagueTournamentId)
    .order('pick_number', { ascending: true })

  const pickPlayerIds = [...new Set((picksRaw ?? []).map((p: any) => p.player_id))]
  const { data: pickPlayersRaw } = pickPlayerIds.length > 0
    ? await supabase.from('players').select('id, name').in('id', pickPlayerIds)
    : { data: [] }

  const pickPlayerMap = new Map(((pickPlayersRaw ?? []) as any[]).map((p) => [p.id, p.name]))

  const picks: PickWithPlayer[] = (picksRaw ?? []).map((p: any) => ({
    id: p.id,
    pick_number: p.pick_number,
    round: p.round,
    user_id: p.user_id,
    player_id: p.player_id,
    player_name: pickPlayerMap.get(p.player_id) ?? 'Unknown',
  }))

  // Load available players with scores
  const draftedPlayerIds = picks.map((p) => p.player_id)

  const { data: scoresRaw } = await supabase
    .from('player_scores')
    .select('player_id, total_strokes, position, thru')
    .eq('tournament_id', tournamentId)

  const scoresMap = new Map(
    (scoresRaw ?? []).map((s: any) => [s.player_id, s])
  )

  const { data: allPlayersRaw } = await supabase
    .from('players')
    .select('id, name, espn_player_id')

  const availablePlayers: AvailablePlayer[] = ((allPlayersRaw ?? []) as any[])
    .filter((p) => !draftedPlayerIds.includes(p.id))
    .map((p) => {
      const score = scoresMap.get(p.id)
      return {
        id: p.id,
        name: p.name,
        espn_player_id: p.espn_player_id ?? null,
        status: 'active',
        total_strokes: score?.total_strokes ?? null,
        position: score?.position ?? null,
        thru: score?.thru ?? null,
      }
    })

  const myPicks = picks.filter((p) => p.user_id === userId)

  return (
    <DraftBoard
      leagueId={leagueTournamentId}
      leagueName={leagueName}
      tournamentName={lt.tournaments?.name ?? 'Tournament'}
      leagueStatus={lt.status}
      currentUserId={userId}
      draftState={draftState}
      picks={picks}
      myPicks={myPicks}
      availablePlayers={availablePlayers}
      members={members}
    />
  )
}
