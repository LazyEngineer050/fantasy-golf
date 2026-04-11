import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fetchCurrentEspnEventId, fetchEspnLeaderboard } from '@/lib/espn'
import CommissionerBoard from './_components/CommissionerBoard'
import type { CutPlayer } from '@/app/actions/commissioner'

export interface ExistingPick {
  pickId: string
  playerId: string
  espnPlayerId: string | null
  playerName: string
  round: number
}

export interface ExistingTeam {
  userId: string
  displayName: string
  picks: ExistingPick[]
}

// Fallback: 2025 Masters players who made the cut (used if ESPN is unreachable)
const MASTERS_2025_CUT: CutPlayer[] = [
  { espnPlayerId: '3470', name: 'Rory McIlroy', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3470_jj', name: 'Justin Rose', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3221', name: 'Bryson DeChambeau', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3448', name: 'Collin Morikawa', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '10196', name: 'Ludvig Åberg', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3700', name: 'Tommy Fleetwood', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3883', name: 'Min Woo Lee', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3996', name: 'Scottie Scheffler', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3911', name: 'Xander Schauffele', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '1216', name: 'Jon Rahm', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3622', name: 'Viktor Hovland', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3454', name: 'Patrick Cantlay', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3325', name: 'Hideki Matsuyama', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '2765', name: 'Brooks Koepka', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3629', name: 'Sahith Theegala', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3643', name: 'Shane Lowry', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3632', name: 'Cam Smith', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3226', name: 'Tony Finau', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3448_jd', name: 'Jason Day', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3634', name: 'Corey Conners', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3700_as', name: 'Adam Scott', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3645', name: 'Sepp Straka', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3448_ht', name: 'Tyrrell Hatton', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3991', name: 'Akshay Bhatia', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '4360', name: 'Tom Kim', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3877', name: 'Russell Henley', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3878', name: 'Cameron Young', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '4040', name: 'Sungjae Im', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3880', name: 'Joaquin Niemann', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '4848', name: 'Jacob Bridgeman', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3699', name: 'Matt Fitzpatrick', madeCut: true, position: null, totalStrokes: null, thru: null },
  { espnPlayerId: '3456', name: 'Si Woo Kim', madeCut: true, position: null, totalStrokes: null, thru: null },
]

export default async function CommissionerPage() {
  const supabase = await createSupabaseServerClient()

  // Load leagues with their tournament info
  const { data: leaguesRaw } = await supabase
    .from('leagues')
    .select('id, name, status, tournament_id, tournaments(id, name)')
    .order('name', { ascending: true })

  type LeagueRow = {
    id: string
    name: string
    status: string
    tournament_id: string
    tournaments: { id: string; name: string } | null
  }

  const leagues = ((leaguesRaw ?? []) as unknown as LeagueRow[]).map((l) => ({
    id: l.id,
    name: l.name,
    status: l.status as 'drafting' | 'live' | 'completed',
    tournamentId: l.tournaments?.id ?? l.tournament_id,
    tournamentName: l.tournaments?.name ?? 'Unknown',
  }))

  // Try ESPN for current event
  let cutPlayers: CutPlayer[] = []
  let espnSource = false

  try {
    const eventId = await fetchCurrentEspnEventId()
    if (eventId) {
      const espnPlayers = await fetchEspnLeaderboard(eventId)
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
    // Fall through to hardcoded list
  }

  if (cutPlayers.length === 0) {
    cutPlayers = MASTERS_2025_CUT
  }

  // Load existing teams for all leagues
  const leagueIds = leagues.map((l) => l.id)

  const [membersResult, picksResult] = await Promise.all([
    leagueIds.length > 0
      ? supabase
          .from('league_members')
          .select('league_id, user_id, draft_position, users(display_name)')
          .in('league_id', leagueIds)
          .order('draft_position', { ascending: true })
      : Promise.resolve({ data: [] }),
    leagueIds.length > 0
      ? supabase
          .from('picks')
          .select('id, league_id, user_id, player_id, round, pick_number')
          .in('league_id', leagueIds)
          .order('round', { ascending: true })
      : Promise.resolve({ data: [] }),
  ])

  type MemberRow2 = { league_id: string; user_id: string; draft_position: number; users: { display_name: string } | null }
  type PickRow2 = { id: string; league_id: string; user_id: string; player_id: string; round: number; pick_number: number }

  const members2 = ((membersResult.data ?? []) as unknown as MemberRow2[])
  const picks2 = ((picksResult.data ?? []) as unknown as PickRow2[])

  // Fetch player names for all picked players
  const allPlayerIds = [...new Set(picks2.map((p) => p.player_id))]
  const { data: playerNamesRaw } = allPlayerIds.length > 0
    ? await supabase.from('players').select('id, name, espn_player_id').in('id', allPlayerIds)
    : { data: [] }

  type PlayerNameRow = { id: string; name: string; espn_player_id: string | null }
  const playerNameMap = new Map(
    ((playerNamesRaw ?? []) as unknown as PlayerNameRow[]).map((p) => [p.id, { name: p.name, espnPlayerId: p.espn_player_id }])
  )

  // Build existingTeams keyed by leagueId
  const existingTeamsByLeague: Record<string, ExistingTeam[]> = {}

  for (const m of members2) {
    if (!existingTeamsByLeague[m.league_id]) existingTeamsByLeague[m.league_id] = []
    const teamPicks = picks2
      .filter((p) => p.league_id === m.league_id && p.user_id === m.user_id)
      .map((p) => ({
        pickId: p.id,
        playerId: p.player_id,
        espnPlayerId: playerNameMap.get(p.player_id)?.espnPlayerId ?? null,
        playerName: playerNameMap.get(p.player_id)?.name ?? 'Unknown',
        round: p.round,
      }))
    existingTeamsByLeague[m.league_id].push({
      userId: m.user_id,
      displayName: m.users?.display_name ?? 'Unknown',
      picks: teamPicks,
    })
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-green-400">⛳ ButteryBiscuits — Commissioner</h1>
          <p className="text-gray-400 text-sm mt-1">Build teams and record the draft</p>
        </div>
        {espnSource && (
          <span className="text-xs bg-green-900 text-green-300 px-3 py-1 rounded-full font-medium">
            Live from ESPN
          </span>
        )}
        {!espnSource && (
          <span className="text-xs bg-yellow-900 text-yellow-300 px-3 py-1 rounded-full font-medium">
            2025 Masters fallback
          </span>
        )}
      </div>
      <CommissionerBoard leagues={leagues} cutPlayers={cutPlayers} existingTeamsByLeague={existingTeamsByLeague} />
    </div>
  )
}
