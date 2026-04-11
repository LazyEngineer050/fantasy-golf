import { createSupabaseServerClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import DraftBoard from './_components/DraftBoard'
import type { AvailablePlayer, DraftStateWithMembers, PickWithPlayer } from '@/lib/types'

interface PageProps {
  params: Promise<{ leagueId: string }>
}

export default async function DraftPage({ params }: PageProps) {
  const { leagueId } = await params
  const cookieStore = await cookies()
  const userId = cookieStore.get('user_id')?.value ?? null

  const supabase = await createSupabaseServerClient()

  // Load league
  const { data: leagueRaw } = await supabase
    .from('leagues')
    .select('*, tournaments(*)')
    .eq('id', leagueId)
    .single()

  if (!leagueRaw) notFound()

  const league = leagueRaw as unknown as {
    id: string
    name: string
    status: 'drafting' | 'live' | 'completed'
    tournament_id: string
    tournaments: { id: string; name: string; espn_event_id: string | null }
  }

  const tournamentId: string = league.tournaments?.id ?? league.tournament_id

  // Load draft state + members with display names
  const { data: state } = await supabase
    .from('draft_state')
    .select('*')
    .eq('league_id', leagueId)
    .single()

  const { data: membersRaw } = await supabase
    .from('league_members')
    .select('user_id, draft_position, users(display_name)')
    .eq('league_id', leagueId)
    .order('draft_position', { ascending: true })

  const members = (membersRaw ?? []).map((m: any) => ({
    user_id: m.user_id,
    draft_position: m.draft_position,
    display_name: m.users?.display_name ?? 'Unknown',
  }))

  const typedState = state as unknown as {
    league_id: string; round: number; pick_number: number
    on_clock_user_id: string | null; direction: number; started_at: string
  } | null

  const draftState: DraftStateWithMembers | null = typedState
    ? { ...typedState, members }
    : null

  // Load existing picks
  const { data: picksRaw } = await supabase
    .from('picks')
    .select('id, pick_number, round, user_id, player_id, players(name)')
    .eq('league_id', leagueId)
    .order('pick_number', { ascending: true })

  const picks: PickWithPlayer[] = (picksRaw ?? []).map((p: any) => ({
    id: p.id,
    pick_number: p.pick_number,
    round: p.round,
    user_id: p.user_id,
    player_id: p.player_id,
    player_name: p.players?.name ?? 'Unknown',
  }))

  // Load available (active, un-drafted) players with scores
  const draftedPlayerIds = picks.map((p) => p.player_id)

  const { data: availableRaw } = await supabase
    .from('tournament_players')
    .select('player_id, status, players(id, name, espn_player_id)')
    .eq('tournament_id', tournamentId)
    .eq('status', 'active')

  const availableFiltered = (availableRaw ?? []).filter(
    (tp: any) => !draftedPlayerIds.includes(tp.player_id)
  )

  const availablePlayerIds = availableFiltered.map((tp: any) => tp.player_id)

  const { data: scoresRaw } = await supabase
    .from('player_scores')
    .select('player_id, total_strokes, position, thru')
    .eq('tournament_id', tournamentId)
    .in('player_id', availablePlayerIds.length > 0 ? availablePlayerIds : ['00000000-0000-0000-0000-000000000000'])

  const scoresMap = new Map(
    (scoresRaw ?? []).map((s: any) => [s.player_id, s])
  )

  const availablePlayers: AvailablePlayer[] = availableFiltered.map((tp: any) => {
    const score = scoresMap.get(tp.player_id)
    return {
      id: (tp.players as any)?.id ?? tp.player_id,
      name: (tp.players as any)?.name ?? 'Unknown',
      espn_player_id: (tp.players as any)?.espn_player_id ?? null,
      status: tp.status,
      total_strokes: score?.total_strokes ?? null,
      position: score?.position ?? null,
      thru: score?.thru ?? null,
    }
  })

  // My team picks
  const myPicks = picks.filter((p) => p.user_id === userId)

  return (
    <DraftBoard
      leagueId={leagueId}
      leagueName={league.name}
      tournamentName={league.tournaments?.name ?? 'Tournament'}
      leagueStatus={league.status}
      currentUserId={userId}
      draftState={draftState}
      picks={picks}
      myPicks={myPicks}
      availablePlayers={availablePlayers}
      members={members}
    />
  )
}
