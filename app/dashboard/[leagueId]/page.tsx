import { createSupabaseServerClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import Leaderboard from './_components/Leaderboard'
import type { TeamStanding } from '@/lib/types'

interface PageProps {
  params: Promise<{ leagueId: string }>
}

export default async function DashboardPage({ params }: PageProps) {
  const { leagueId } = await params
  const cookieStore = await cookies()
  const currentUserId = cookieStore.get('user_id')?.value ?? null

  const supabase = await createSupabaseServerClient()

  // Load all leagues for the switcher — show tournament name, not league name
  const { data: allLeaguesRaw } = await supabase
    .from('leagues')
    .select('id, tournaments(name, start_date)')
    .order('tournament_id', { ascending: true })

  type AllLeagueRow = { id: string; tournaments: { name: string; start_date: string } | null }
  const allLeagues = ((allLeaguesRaw ?? []) as unknown as AllLeagueRow[])
    .filter((l) => l.tournaments)
    .sort((a, b) => b.tournaments!.start_date.localeCompare(a.tournaments!.start_date))
    .map((l) => {
      const year = new Date(l.tournaments!.start_date + 'T12:00:00Z').getFullYear()
      return { id: l.id, name: `${l.tournaments!.name} ${year}` }
    })

  // Load league + tournament
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

  type TeamScoreRow = { user_id: string; total_strokes: number | null; rank: number | null; users: { display_name: string } | null }

  // Load team scores + user names
  const { data: teamScoresRaw } = await supabase
    .from('team_scores')
    .select('user_id, total_strokes, rank, users(display_name)')
    .eq('league_id', leagueId)
    .order('rank', { ascending: true })

  const teamScores = (teamScoresRaw ?? []) as unknown as TeamScoreRow[]

  // Load all picks for this league — include round (draft round)
  type RawPick = { user_id: string; player_id: string; round: number }
  const { data: picksRaw } = await supabase
    .from('picks')
    .select('user_id, player_id, round')
    .eq('league_id', leagueId)
    .order('round', { ascending: true })

  const picks = (picksRaw ?? []) as unknown as RawPick[]
  const playerIds = [...new Set(picks.map((p) => p.player_id))]

  // Fetch player names and scores in parallel
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

  // If no team_scores yet (draft just ended), still show members
  if (standings.length === 0) {
    type MemberRow = { user_id: string; users: { display_name: string } | null }
    const { data: membersRaw2 } = await supabase
      .from('league_members')
      .select('user_id, users(display_name)')
      .eq('league_id', leagueId)

    const members2 = (membersRaw2 ?? []) as unknown as MemberRow[]
    for (const m of members2) {
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
      leagueId={leagueId}
      leagueName={league.name}
      tournamentName={league.tournaments?.name ?? 'Tournament'}
      leagueStatus={league.status}
      standings={standings}
      currentUserId={currentUserId}
      allLeagues={allLeagues}
    />
  )
}
