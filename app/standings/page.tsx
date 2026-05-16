import { createSupabaseServerClient } from '@/lib/supabase/server'
import Link from 'next/link'

function fmtMoney(n: number) {
  const abs = Math.abs(n)
  const str = Number.isInteger(abs) ? `$${abs}` : `$${abs.toFixed(2)}`
  return n >= 0 ? `+${str}` : `-${str}`
}

function moneyClass(n: number) {
  if (n > 0) return 'text-green-400'
  if (n < 0) return 'text-red-400'
  return 'text-gray-500'
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function computeLeagueWinnings(
  teamScores: Array<{ user_id: string; total_strokes: number | null }>,
  picks: Array<{ user_id: string; player_id: string }>,
  playerScoreMap: Map<string, number | null>,
): Map<string, number> {
  const w = new Map<string, number>()
  for (const ts of teamScores) w.set(ts.user_id, -20)

  const scored = teamScores.filter((s) => s.total_strokes !== null)
  if (scored.length === 0) return w

  const bestTeamScore  = Math.min(...scored.map((s) => s.total_strokes!))
  const worstTeamScore = Math.max(...scored.map((s) => s.total_strokes!))
  const bestTeams  = scored.filter((s) => s.total_strokes === bestTeamScore)
  const worstTeams = scored.filter((s) => s.total_strokes === worstTeamScore)

  for (const t of bestTeams) w.set(t.user_id, w.get(t.user_id)! + 30 / bestTeams.length)

  if (worstTeamScore !== bestTeamScore) {
    for (const t of worstTeams) w.set(t.user_id, w.get(t.user_id)! - 5 / worstTeams.length)
    for (const t of bestTeams)  w.set(t.user_id, w.get(t.user_id)! + 5 / bestTeams.length)
  }

  const scoredPicks = picks.flatMap((p) => {
    const score = playerScoreMap.get(p.player_id)
    return score !== null && score !== undefined ? [{ user_id: p.user_id, score }] : []
  })
  if (scoredPicks.length > 0) {
    const best = Math.min(...scoredPicks.map((p) => p.score))
    const owners = new Set(scoredPicks.filter((p) => p.score === best).map((p) => p.user_id))
    for (const uid of owners) w.set(uid, (w.get(uid) ?? 0) + 50 / owners.size)
  }

  return w
}

export default async function StandingsPage() {
  const supabase = await createSupabaseServerClient()

  // Load all completed + live league_tournaments with tournament info, newest first
  const { data: ltRaw } = await supabase
    .from('league_tournaments')
    .select('id, status, tournament_id, league_season_id, tournaments(id, name, start_date, end_date)')
    .in('status', ['completed', 'live'])

  type LTRow = {
    id: string
    status: 'completed' | 'live'
    tournament_id: string
    league_season_id: string
    tournaments: { id: string; name: string; start_date: string; end_date: string } | null
  }

  const lts = ((ltRaw ?? []) as unknown as LTRow[])
    .filter((lt) => lt.tournaments)
    .sort((a, b) => b.tournaments!.start_date.localeCompare(a.tournaments!.start_date))

  if (lts.length === 0) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <Header />
        <p className="text-center text-gray-500 text-sm py-16">No completed tournaments yet.</p>
      </div>
    )
  }

  const ltIds = lts.map((lt) => lt.id)

  // Team scores + members for all league_tournaments
  const [teamScoresResult, membersResult, picksResult] = await Promise.all([
    supabase.from('team_scores').select('league_tournament_id, user_id, total_strokes').in('league_tournament_id', ltIds),
    supabase.from('league_season_members').select('league_season_id, user_id, users(display_name)').in('league_season_id', lts.map((lt) => lt.league_season_id)),
    supabase.from('picks').select('league_tournament_id, user_id, player_id').in('league_tournament_id', ltIds),
  ])

  type TSRow = { league_tournament_id: string; user_id: string; total_strokes: number | null }
  type MemRow = { league_season_id: string; user_id: string; users: { display_name: string } | null }
  type PickRow = { league_tournament_id: string; user_id: string; player_id: string }

  const teamScores = (teamScoresResult.data ?? []) as unknown as TSRow[]
  const members    = (membersResult.data   ?? []) as unknown as MemRow[]
  const picks      = (picksResult.data     ?? []) as unknown as PickRow[]

  // Fetch player scores
  const playerIds     = [...new Set(picks.map((p) => p.player_id))]
  const tournamentIds = [...new Set(lts.map((lt) => lt.tournament_id))]

  const { data: psRaw } = playerIds.length > 0
    ? await supabase
        .from('player_scores')
        .select('tournament_id, player_id, total_strokes')
        .in('tournament_id', tournamentIds)
        .in('player_id', playerIds)
    : { data: [] }

  type PSRow = { tournament_id: string; player_id: string; total_strokes: number | null }
  const playerScores = (psRaw ?? []) as unknown as PSRow[]

  // Build per-league_tournament player score maps (keyed by tournament_id)
  const psMapByLT = new Map<string, Map<string, number | null>>()
  for (const lt of lts) {
    const m = new Map<string, number | null>()
    for (const ps of playerScores) {
      if (ps.tournament_id === lt.tournament_id) m.set(ps.player_id, ps.total_strokes)
    }
    psMapByLT.set(lt.id, m)
  }

  // Build display name map (from league_season_members)
  const nameMap = new Map<string, string>()
  for (const m of members) {
    if (m.users?.display_name) nameMap.set(m.user_id, m.users.display_name)
  }

  // All unique users across all lts (preserve first-appearance order)
  const allUserIds: string[] = []
  const seenUsers = new Set<string>()
  for (const m of members) {
    if (!seenUsers.has(m.user_id)) { seenUsers.add(m.user_id); allUserIds.push(m.user_id) }
  }

  // Compute winnings per lt per user
  const winningsByLT = new Map<string, Map<string, number>>()
  for (const lt of lts) {
    const ltTeamScores = teamScores.filter((ts) => ts.league_tournament_id === lt.id)
    const ltPicks      = picks.filter((p) => p.league_tournament_id === lt.id)
    const psMap        = psMapByLT.get(lt.id) ?? new Map()
    winningsByLT.set(lt.id, computeLeagueWinnings(ltTeamScores, ltPicks, psMap))
  }

  // Total winnings per user
  const totals = new Map<string, number>()
  for (const uid of allUserIds) {
    let sum = 0
    for (const [, lw] of winningsByLT) sum += lw.get(uid) ?? 0
    totals.set(uid, sum)
  }

  const sortedUsers = [...allUserIds].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Header />
      <div className="max-w-5xl mx-auto p-6">
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Tournament</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Date</th>
                {sortedUsers.map((uid, i) => (
                  <th key={uid} className={`px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${i === 0 ? 'text-yellow-400' : 'text-gray-400'}`}>
                    {i === 0 && <span className="mr-1">🏆</span>}
                    {nameMap.get(uid) ?? uid}
                    <span className={`block font-normal normal-case text-xs mt-0.5 ${moneyClass(totals.get(uid) ?? 0)}`}>
                      {fmtMoney(totals.get(uid) ?? 0)}
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {lts.map((lt) => {
                const isLive = lt.status === 'live'
                return (
                  <tr key={lt.id} className={`border-b border-gray-800 last:border-0 ${isLive ? 'bg-green-950/20' : 'hover:bg-gray-800/40'}`}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`font-medium ${isLive ? 'text-green-400' : 'text-gray-200'}`}>
                        {lt.tournaments!.name}
                        {isLive && <span className="ml-2 text-xs text-green-600 font-medium">● LIVE*</span>}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-sm whitespace-nowrap ${isLive ? 'text-green-600' : 'text-gray-500'}`}>
                      {fmtDate(lt.tournaments!.start_date)}
                    </td>
                    {sortedUsers.map((uid) => {
                      const net = winningsByLT.get(lt.id)?.get(uid)
                      return (
                        <td key={uid} className="px-4 py-3 text-center tabular-nums">
                          {net !== undefined
                            ? <span className={`font-medium ${moneyClass(net)}`}>{fmtMoney(net)}</span>
                            : <span className="text-gray-700">—</span>
                          }
                        </td>
                      )
                    })}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link href={`/dashboard/${lt.id}`} className={`text-xs px-2 py-1 rounded font-medium transition-colors ${isLive ? 'bg-green-800 hover:bg-green-700 text-green-200' : 'bg-gray-800 hover:bg-gray-700 text-gray-400'}`}>
                        Leaderboard →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 bg-gray-900 rounded-xl border border-gray-800 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Prize Structure</p>
          <div className="flex gap-6 flex-wrap text-xs text-gray-400 mb-2">
            <span><span className="text-gray-300 font-medium">Buy-in</span> $20</span>
            <span><span className="text-gray-300 font-medium">Best team</span> +$30</span>
            <span><span className="text-gray-300 font-medium">Best player</span> +$50</span>
            <span><span className="text-gray-300 font-medium">Side-bet</span> worst pays best +$5</span>
          </div>
          <p className="text-xs text-green-700">* In progress — projected winnings</p>
        </div>
      </div>
    </div>
  )
}

function Header() {
  return (
    <div className="bg-gray-900 border-b border-gray-800 px-6 py-5">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-green-400">⛳ ButteryBiscuits</h1>
          <p className="text-gray-400 text-sm mt-1">Pride Points — All-Time Standings</p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link href="/commissioner" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors">Commissioner</Link>
          <Link href="/admin" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors">Admin</Link>
        </div>
      </div>
    </div>
  )
}
