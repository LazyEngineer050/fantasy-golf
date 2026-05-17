import { createSupabaseServerClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import Leaderboard from './_components/Leaderboard'
import type { TeamStanding } from '@/lib/types'

interface PageProps {
  params: Promise<{ leagueTournamentId: string }>
}

export default async function DashboardPage({ params }: PageProps) {
  const { leagueTournamentId } = await params
  const cookieStore = await cookies()
  const currentUserId = cookieStore.get('user_id')?.value ?? null

  const supabase = await createSupabaseServerClient()

  // Load this league_tournament
  const { data: ltRaw } = await supabase
    .from('league_tournaments')
    .select('id, status, tournament_id, league_season_id, tournaments(*), league_seasons(league_id, leagues(name))')
    .eq('id', leagueTournamentId)
    .single()

  if (!ltRaw) notFound()

  type LTRow = {
    id: string
    status: 'drafting' | 'live' | 'completed'
    tournament_id: string
    league_season_id: string
    tournaments: { id: string; name: string; espn_event_id: string | null } | null
    league_seasons: { league_id: string; leagues: { name: string } | null } | null
  }

  const lt = ltRaw as unknown as LTRow
  const tournamentId: string = lt.tournaments?.id ?? lt.tournament_id
  type TeamScoreRow = { user_id: string; total_strokes: number | null; rank: number | null; users: { display_name: string } | null }

  const { data: teamScoresRaw } = await supabase
    .from('team_scores')
    .select('user_id, total_strokes, rank, users(display_name)')
    .eq('league_tournament_id', leagueTournamentId)
    .order('rank', { ascending: true })

  const teamScores = (teamScoresRaw ?? []) as unknown as TeamScoreRow[]

  type RawPick = { user_id: string; player_id: string; round: number }
  const { data: picksRaw } = await supabase
    .from('picks')
    .select('user_id, player_id, round')
    .eq('league_tournament_id', leagueTournamentId)
    .order('round', { ascending: true })

  const picks = (picksRaw ?? []) as unknown as RawPick[]
  const playerIds = [...new Set(picks.map((p) => p.player_id))]

  type ScoreRow = {
    player_id: string
    total_strokes: number | null
    today_strokes: number | null
    thru: string | null
    position: string | null
    tee_time: string | null
    r1_strokes: number | null
    r2_strokes: number | null
    r3_strokes: number | null
    r4_strokes: number | null
  }

  const [playersResult, scoresResult] = await Promise.all([
    playerIds.length > 0
      ? supabase.from('players').select('id, name').in('id', playerIds)
      : Promise.resolve({ data: [] }),
    playerIds.length > 0
      ? supabase
          .from('player_scores')
          .select('player_id, total_strokes, today_strokes, thru, position, tee_time, r1_strokes, r2_strokes, r3_strokes, r4_strokes')
          .eq('tournament_id', tournamentId)
          .in('player_id', playerIds)
      : Promise.resolve({ data: [] }),
  ])

  type PlayerRow = { id: string; name: string }

  const playerNameMap = new Map(
    ((playersResult.data ?? []) as unknown as PlayerRow[]).map((p) => [p.id, p.name])
  )
  const scoreMap = new Map(
    ((scoresResult.data ?? []) as unknown as ScoreRow[]).map((s) => [s.player_id, s])
  )

  const picksByUser = new Map<string, TeamStanding['picks']>()
  for (const p of picks) {
    const score = scoreMap.get(p.player_id)
    const entry = {
      player_id: p.player_id,
      player_name: playerNameMap.get(p.player_id) ?? 'Unknown',
      draft_round: p.round,
      total_strokes: score?.total_strokes ?? null,
      today_strokes: score?.today_strokes ?? null,
      thru: score?.thru ?? null,
      position: score?.position ?? null,
      tee_time: score?.tee_time ?? null,
      r1_strokes: score?.r1_strokes ?? null,
      r2_strokes: score?.r2_strokes ?? null,
      r3_strokes: score?.r3_strokes ?? null,
      r4_strokes: score?.r4_strokes ?? null,
    }
    if (!picksByUser.has(p.user_id)) picksByUser.set(p.user_id, [])
    picksByUser.get(p.user_id)!.push(entry)
  }

  const standings: TeamStanding[] = teamScores.map((ts) => ({
    user_id: ts.user_id,
    display_name: ts.users?.display_name ?? 'Unknown',
    total_strokes: ts.total_strokes,
    rank: ts.rank,
    picks: picksByUser.get(ts.user_id) ?? [],
  }))

  if (standings.length === 0) {
    type MemberRow = { user_id: string; users: { display_name: string } | null }
    const { data: membersRaw } = await supabase
      .from('league_season_members')
      .select('user_id, users(display_name)')
      .eq('league_season_id', lt.league_season_id)

    const members = (membersRaw ?? []) as unknown as MemberRow[]
    for (const m of members) {
      standings.push({
        user_id: m.user_id,
        display_name: m.users?.display_name ?? 'Unknown',
        total_strokes: null,
        rank: null,
        picks: picksByUser.get(m.user_id) ?? [],
      })
    }
  }

  return (
    <Leaderboard
      leagueTournamentId={leagueTournamentId}
      tournamentName={lt.tournaments?.name ?? 'Tournament'}
      leagueStatus={lt.status}
      standings={standings}
      currentUserId={currentUserId}
    />
  )
}
