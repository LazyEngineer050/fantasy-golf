import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fetchCurrentEspnEvent, fetchEspnLeaderboard } from '@/lib/espn'
import CommissionerBoard from './_components/CommissionerBoard'
import type { CutPlayer } from '@/app/actions/commissioner'

export interface LeagueRow {
  id: string
  name: string
}

export interface SeasonRow {
  id: string
  year: number
}

export interface LeagueSeasonRow {
  id: string
  leagueId: string
  seasonId: string
  members: Array<{ userId: string; displayName: string; draftPosition: number }>
}

export interface LeagueTournamentRow {
  id: string
  leagueSeasonId: string
  tournamentId: string
  tournamentName: string
  status: 'drafting' | 'live' | 'completed'
}

export interface TournamentRow {
  id: string
  name: string
  startDate: string
  seasonId: string | null
  espnEventId: string | null
}

export interface UserRow {
  id: string
  displayName: string
}

// Existing picks per league_tournament for Manage view
export interface ExistingTeamPicks {
  userId: string
  displayName: string
  picks: Array<{ pickId: string; playerId: string; espnPlayerId: string | null; playerName: string; round: number }>
}

// Hardcoded fallback player list (updated for 2026)
const FALLBACK_PLAYERS: CutPlayer[] = [
  { espnPlayerId: '3996', name: 'Scottie Scheffler', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3470', name: 'Rory McIlroy', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3911', name: 'Xander Schauffele', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3448', name: 'Collin Morikawa', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '10196', name: 'Ludvig Åberg', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3622', name: 'Viktor Hovland', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3700', name: 'Tommy Fleetwood', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3883', name: 'Min Woo Lee', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3454', name: 'Patrick Cantlay', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3325', name: 'Hideki Matsuyama', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '2765', name: 'Brooks Koepka', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3629', name: 'Sahith Theegala', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '1216', name: 'Jon Rahm', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3221', name: 'Bryson DeChambeau', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3991', name: 'Akshay Bhatia', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '4360', name: 'Tom Kim', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3877', name: 'Russell Henley', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3878', name: 'Cameron Young', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3699', name: 'Matt Fitzpatrick', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3643', name: 'Shane Lowry', madeCut: true, position: null, totalStrokes: null, thru: null },
]

export default async function CommissionerPage() {
  const supabase = await createSupabaseServerClient()

  // Load all structural data in parallel
  const [leaguesResult, seasonsResult, lsResult, lsmResult, ltResult, tournamentsResult, usersResult] = await Promise.all([
    supabase.from('leagues').select('id, name').order('name'),
    supabase.from('seasons').select('id, year').order('year', { ascending: false }),
    supabase.from('league_seasons').select('id, league_id, season_id'),
    supabase.from('league_season_members').select('league_season_id, user_id, draft_position, users(display_name)').order('draft_position'),
    supabase.from('league_tournaments').select('id, league_season_id, tournament_id, status, tournaments(name, start_date)').order('created_at', { ascending: false }),
    supabase.from('tournaments').select('id, name, start_date, season_id, espn_event_id').order('start_date', { ascending: false }),
    supabase.from('users').select('id, display_name').order('display_name'),
  ])

  type RawLS = { id: string; league_id: string; season_id: string }
  type RawLSM = { league_season_id: string; user_id: string; draft_position: number; users: { display_name: string } | null }
  type RawLT = { id: string; league_season_id: string; tournament_id: string; status: string; tournaments: { name: string; start_date: string } | null }
  type RawTournament = { id: string; name: string; start_date: string; season_id: string | null; espn_event_id: string | null }
  type RawUser = { id: string; display_name: string }

  const leagues: LeagueRow[] = ((leaguesResult.data ?? []) as unknown as { id: string; name: string }[])
    .map((l) => ({ id: l.id, name: l.name }))

  const seasons: SeasonRow[] = ((seasonsResult.data ?? []) as unknown as { id: string; year: number }[])
    .map((s) => ({ id: s.id, year: s.year }))

  const rawLS = (lsResult.data ?? []) as unknown as RawLS[]
  const rawLSM = (lsmResult.data ?? []) as unknown as RawLSM[]
  const rawLT = (ltResult.data ?? []) as unknown as RawLT[]
  const rawTournaments = (tournamentsResult.data ?? []) as unknown as RawTournament[]
  const rawUsers = (usersResult.data ?? []) as unknown as RawUser[]

  const users: UserRow[] = rawUsers.map((u) => ({ id: u.id, displayName: u.display_name }))

  // Build league_seasons with members
  const leagueSeasons: LeagueSeasonRow[] = rawLS.map((ls) => ({
    id: ls.id,
    leagueId: ls.league_id,
    seasonId: ls.season_id,
    members: rawLSM
      .filter((m) => m.league_season_id === ls.id)
      .map((m) => ({ userId: m.user_id, displayName: m.users?.display_name ?? 'Unknown', draftPosition: m.draft_position })),
  }))

  // Build league_tournaments
  const leagueTournaments: LeagueTournamentRow[] = rawLT.map((lt) => ({
    id: lt.id,
    leagueSeasonId: lt.league_season_id,
    tournamentId: lt.tournament_id,
    tournamentName: lt.tournaments?.name ?? 'Unknown',
    status: lt.status as 'drafting' | 'live' | 'completed',
  }))

  const tournaments: TournamentRow[] = rawTournaments.map((t) => ({
    id: t.id,
    name: t.name,
    startDate: t.start_date,
    seasonId: t.season_id,
    espnEventId: t.espn_event_id,
  }))

  // Load picks for all league_tournaments (for Manage view)
  const ltIds = leagueTournaments.map((lt) => lt.id)
  const [picksResult, playerNamesResult] = await Promise.all([
    ltIds.length > 0
      ? supabase.from('picks').select('id, league_tournament_id, user_id, player_id, round, pick_number').in('league_tournament_id', ltIds).order('round')
      : Promise.resolve({ data: [] }),
    Promise.resolve({ data: [] as unknown[] }),
  ])

  type RawPick = { id: string; league_tournament_id: string; user_id: string; player_id: string; round: number; pick_number: number }
  const rawPicks = (picksResult.data ?? []) as unknown as RawPick[]

  const allPlayerIds = [...new Set(rawPicks.map((p) => p.player_id))]
  let playerNameMap = new Map<string, { name: string; espnPlayerId: string | null }>()
  if (allPlayerIds.length > 0) {
    const { data: pn } = await supabase.from('players').select('id, name, espn_player_id').in('id', allPlayerIds)
    for (const p of (pn ?? []) as unknown as { id: string; name: string; espn_player_id: string | null }[]) {
      playerNameMap.set(p.id, { name: p.name, espnPlayerId: p.espn_player_id })
    }
  }

  // Build existingTeamsByLT
  const existingTeamsByLT: Record<string, ExistingTeamPicks[]> = {}
  for (const lt of leagueTournaments) {
    const ls = leagueSeasons.find((ls) => ls.id === lt.leagueSeasonId)
    if (!ls) continue
    existingTeamsByLT[lt.id] = ls.members.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      picks: rawPicks
        .filter((p) => p.league_tournament_id === lt.id && p.user_id === m.userId)
        .map((p) => ({
          pickId: p.id,
          playerId: p.player_id,
          espnPlayerId: playerNameMap.get(p.player_id)?.espnPlayerId ?? null,
          playerName: playerNameMap.get(p.player_id)?.name ?? 'Unknown',
          round: p.round,
        })),
    }))
  }

  // ESPN player pool
  let cutPlayers: CutPlayer[] = []
  let espnSource = false
  let espnEventId: string | null = null
  let espnEventName: string | null = null
  try {
    const espnEvent = await fetchCurrentEspnEvent()
    if (espnEvent) {
      espnEventId = espnEvent.eventId
      espnEventName = espnEvent.eventName
      const espnPlayers = await fetchEspnLeaderboard(espnEvent.eventId)
      const nonWd = espnPlayers.filter((p) => p.status !== 'wd')
      if (nonWd.length > 0) {
        cutPlayers = nonWd.map((p) => ({
          espnPlayerId: p.espnPlayerId,
          name: p.name,
          madeCut: p.status === 'active',
          position: p.position,
          totalStrokes: p.totalStrokes,
          thru: p.thru,
        }))
        espnSource = true
      }
    }
  } catch {
    // fall through
  }
  if (cutPlayers.length === 0) cutPlayers = FALLBACK_PLAYERS

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-green-400">⛳ ButteryBiscuits — Commissioner</h1>
          <p className="text-gray-400 text-sm mt-1">Manage leagues, seasons, and drafts</p>
        </div>
        <div className="flex items-center gap-3">
          {espnSource
            ? <span className="text-xs bg-green-900 text-green-300 px-3 py-1 rounded-full font-medium">Live from ESPN{espnEventName ? `: ${espnEventName}` : ''}</span>
            : <span className="text-xs bg-yellow-900 text-yellow-300 px-3 py-1 rounded-full font-medium">Fallback player list</span>
          }
        </div>
      </div>
      <CommissionerBoard
        leagues={leagues}
        seasons={seasons}
        leagueSeasons={leagueSeasons}
        leagueTournaments={leagueTournaments}
        tournaments={tournaments}
        users={users}
        cutPlayers={cutPlayers}
        existingTeamsByLT={existingTeamsByLT}
        espnEventId={espnEventId}
        espnEventName={espnEventName}
      />
    </div>
  )
}
