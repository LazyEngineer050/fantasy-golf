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

// Replicated prize logic (must match computeWinnings in Leaderboard.tsx)
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

  // All completed leagues with tournament date, newest first
  const { data: leaguesRaw } = await supabase
    .from('leagues')
    .select('id, tournament_id, tournaments(id, name, start_date, end_date)')
    .eq('status', 'completed')
    .order('tournament_id', { ascending: true }) // will re-sort below by date

  type LeagueRow = {
    id: string
    tournament_id: string
    tournaments: { id: string; name: string; start_date: string; end_date: string } | null
  }
  const leagues = ((leaguesRaw ?? []) as unknown as LeagueRow[])
    .filter((l) => l.tournaments)
    .sort((a, b) => (b.tournaments!.start_date).localeCompare(a.tournaments!.start_date))

  if (leagues.length === 0) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <Header />
        <p className="text-center text-gray-500 text-sm py-16">No completed tournaments yet.</p>
      </div>
    )
  }

  const leagueIds = leagues.map((l) => l.id)

  // Team scores + members for all leagues in one shot
  const [teamScoresResult, membersResult, picksResult] = await Promise.all([
    supabase.from('team_scores').select('league_id, user_id, total_strokes').in('league_id', leagueIds),
    supabase.from('league_members').select('league_id, user_id, users(display_name)').in('league_id', leagueIds),
    supabase.from('picks').select('league_id, user_id, player_id').in('league_id', leagueIds),
  ])

  type TSRow = { league_id: string; user_id: string; total_strokes: number | null }
  type MemRow = { league_id: string; user_id: string; users: { display_name: string } | null }
  type PickRow = { league_id: string; user_id: string; player_id: string }

  const teamScores = (teamScoresResult.data ?? []) as unknown as TSRow[]
  const members    = (membersResult.data   ?? []) as unknown as MemRow[]
  const picks      = (picksResult.data     ?? []) as unknown as PickRow[]

  // Collect all player_ids across all leagues and fetch scores by tournament
  const playerIds     = [...new Set(picks.map((p) => p.player_id))]
  const tournamentIds = [...new Set(leagues.map((l) => l.tournament_id))]

  const { data: psRaw } = playerIds.length > 0
    ? await supabase
        .from('player_scores')
        .select('tournament_id, player_id, total_strokes')
        .in('tournament_id', tournamentIds)
        .in('player_id', playerIds)
    : { data: [] }

  type PSRow = { tournament_id: string; player_id: string; total_strokes: number | null }
  const playerScores = (psRaw ?? []) as unknown as PSRow[]

  // Build per-league player score maps
  const psMapByLeague = new Map<string, Map<string, number | null>>()
  for (const league of leagues) {
    const m = new Map<string, number | null>()
    for (const ps of playerScores) {
      if (ps.tournament_id === league.tournament_id) m.set(ps.player_id, ps.total_strokes)
    }
    psMapByLeague.set(league.id, m)
  }

  // Build display name map
  const nameMap = new Map<string, string>()
  for (const m of members) {
    if (m.users?.display_name) nameMap.set(m.user_id, m.users.display_name)
  }

  // All unique users across all leagues (preserve insertion order = first appearance)
  const allUserIds: string[] = []
  const seenUsers = new Set<string>()
  for (const m of members) {
    if (!seenUsers.has(m.user_id)) { seenUsers.add(m.user_id); allUserIds.push(m.user_id) }
  }

  // Compute winnings per league per user
  const winningsByLeague = new Map<string, Map<string, number>>()
  for (const league of leagues) {
    const leagueTeamScores = teamScores.filter((ts) => ts.league_id === league.id)
    const leaguePicks      = picks.filter((p) => p.league_id === league.id)
    const psMap            = psMapByLeague.get(league.id) ?? new Map()
    winningsByLeague.set(league.id, computeLeagueWinnings(leagueTeamScores, leaguePicks, psMap))
  }

  // Total winnings per user
  const totals = new Map<string, number>()
  for (const uid of allUserIds) {
    let sum = 0
    for (const [, lw] of winningsByLeague) sum += lw.get(uid) ?? 0
    totals.set(uid, sum)
  }

  // Sort users by total winnings descending
  const sortedUsers = [...allUserIds].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Header />
      <div className="max-w-5xl mx-auto p-6">
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Player</th>
                {/* Newest left, oldest right */}
                {leagues.map((l) => (
                  <th key={l.id} className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <Link href={`/dashboard/${l.id}`} className="hover:text-green-400 transition-colors">
                      <span className="block whitespace-nowrap">{l.tournaments!.name}</span>
                      <span className="block text-gray-600 font-normal normal-case">{fmtDate(l.tournaments!.start_date)}</span>
                    </Link>
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-semibold text-yellow-500 uppercase tracking-wide whitespace-nowrap">Total</th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((uid, i) => {
                const total = totals.get(uid) ?? 0
                const isLeader = i === 0
                return (
                  <tr key={uid} className={`border-b border-gray-800 last:border-0 ${isLeader ? 'bg-yellow-950/20' : 'hover:bg-gray-800/40'}`}>
                    <td className={`px-4 py-3 font-semibold whitespace-nowrap ${isLeader ? 'text-yellow-300' : 'text-gray-100'}`}>
                      {isLeader && <span className="mr-1">🏆</span>}
                      {nameMap.get(uid) ?? uid}
                    </td>
                    {leagues.map((l) => {
                      const net = winningsByLeague.get(l.id)?.get(uid)
                      return (
                        <td key={l.id} className="px-3 py-3 text-center tabular-nums">
                          {net !== undefined
                            ? <span className={`font-medium ${moneyClass(net)}`}>{fmtMoney(net)}</span>
                            : <span className="text-gray-700">—</span>
                          }
                        </td>
                      )
                    })}
                    <td className={`px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap ${moneyClass(total)}`}>
                      {fmtMoney(total)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 bg-gray-900 rounded-xl border border-gray-800 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Prize Structure</p>
          <div className="flex gap-6 flex-wrap text-xs text-gray-400">
            <span><span className="text-gray-300 font-medium">Buy-in</span> $20</span>
            <span><span className="text-gray-300 font-medium">Best team</span> +$30</span>
            <span><span className="text-gray-300 font-medium">Best player</span> +$50</span>
            <span><span className="text-gray-300 font-medium">Side-bet</span> worst pays best +$5</span>
          </div>
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
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-400 transition-colors">← Home</Link>
          <h1 className="text-2xl font-bold text-green-400 mt-1">⛳ ButteryBiscuits — All-Time Standings</h1>
          <p className="text-gray-400 text-sm mt-0.5">Lifetime winnings across all tournaments</p>
        </div>
      </div>
    </div>
  )
}
