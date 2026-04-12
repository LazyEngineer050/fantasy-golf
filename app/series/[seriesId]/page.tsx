import { createSupabaseServerClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'

// Points awarded by finish position (1-indexed)
function positionPoints(rank: number | null): number {
  if (rank === null) return 0
  const table = [10, 7, 5, 4, 3, 2]
  if (rank <= 0) return 0
  return rank <= table.length ? table[rank - 1] : 1
}

function fmtScore(s: number | null) {
  if (s === null) return '—'
  if (s === 0) return 'E'
  return s > 0 ? `+${s}` : `${s}`
}

function scoreClass(s: number | null) {
  if (s === null || s === 0) return 'text-gray-300'
  return s < 0 ? 'text-red-400' : 'text-gray-400'
}

export default async function SeriesPage({ params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: series } = await supabase
    .from('series')
    .select('id, name, year')
    .eq('id', seriesId)
    .single()

  if (!series) notFound()

  // All leagues in this series, with their tournament info and team scores
  const { data: leagues } = await supabase
    .from('leagues')
    .select('id, name, status, tournament_id, tournaments(id, name, start_date)')
    .eq('series_id', seriesId)
    .order('name', { ascending: true })

  const leagueList = (leagues ?? []) as unknown as Array<{
    id: string
    name: string
    status: 'drafting' | 'live' | 'completed'
    tournament_id: string
    tournaments: { id: string; name: string; start_date: string } | null
  }>

  // Sort leagues by tournament start_date ascending
  leagueList.sort((a, b) => {
    const da = a.tournaments?.start_date ?? ''
    const db = b.tournaments?.start_date ?? ''
    return da.localeCompare(db)
  })

  if (leagueList.length === 0) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <SeriesHeader name={series.name} year={series.year} />
        <div className="max-w-3xl mx-auto p-6 text-center text-gray-500 text-sm py-16">
          No leagues in this series yet.
        </div>
      </div>
    )
  }

  const leagueIds = leagueList.map((l) => l.id)

  // Fetch team scores for all leagues in one query
  const { data: teamScores } = await supabase
    .from('team_scores')
    .select('league_id, user_id, total_strokes, rank')
    .in('league_id', leagueIds)

  // Fetch all members (for display names)
  const { data: members } = await supabase
    .from('league_members')
    .select('league_id, user_id, users(display_name)')
    .in('league_id', leagueIds)

  type RawMember = { league_id: string; user_id: string; users: { display_name: string } | null }
  const memberList = (members ?? []) as unknown as RawMember[]
  const scoreList = (teamScores ?? []) as Array<{ league_id: string; user_id: string; total_strokes: number | null; rank: number | null }>

  // Build a map of userId -> displayName
  const nameMap = new Map<string, string>()
  for (const m of memberList) {
    if (m.users?.display_name) nameMap.set(m.user_id, m.users.display_name)
  }

  // For each completed (or live) league, calculate points per user
  // Ties: all tied users share the same points for that position
  // Only count completed leagues for final standings; live leagues shown as "in progress"
  const completedLeagues = leagueList.filter((l) => l.status === 'completed')
  const liveLeagues = leagueList.filter((l) => l.status === 'live')
  const upcomingLeagues = leagueList.filter((l) => l.status === 'drafting')

  // Accumulate points across completed leagues
  const pointsMap = new Map<string, number>() // userId -> total points

  for (const league of completedLeagues) {
    const leagueScores = scoreList.filter((s) => s.league_id === league.id)
    // Group by rank to handle ties
    const byRank = new Map<number, string[]>()
    for (const s of leagueScores) {
      if (s.rank === null) continue
      if (!byRank.has(s.rank)) byRank.set(s.rank, [])
      byRank.get(s.rank)!.push(s.user_id)
    }
    // Award shared points for ties (average of positions they occupy)
    for (const [rank, userIds] of byRank) {
      const positions = userIds.map((_, i) => rank + i)
      const sharedPts = Math.round(positions.reduce((sum, p) => sum + positionPoints(p), 0) / userIds.length)
      for (const uid of userIds) {
        pointsMap.set(uid, (pointsMap.get(uid) ?? 0) + sharedPts)
      }
    }
  }

  // Build standings: all users who appear in any league
  const allUserIds = new Set(memberList.map((m) => m.user_id))
  const standings = Array.from(allUserIds).map((uid) => ({
    user_id: uid,
    display_name: nameMap.get(uid) ?? 'Unknown',
    points: pointsMap.get(uid) ?? 0,
  }))
  standings.sort((a, b) => b.points - a.points || a.display_name.localeCompare(b.display_name))

  // Assign ranks (ties get same rank)
  let currentRank = 1
  for (let i = 0; i < standings.length; i++) {
    if (i > 0 && standings[i].points === standings[i - 1].points) {
      ;(standings[i] as any).rank = (standings[i - 1] as any).rank
    } else {
      ;(standings[i] as any).rank = currentRank
    }
    currentRank++
  }

  // Per-league results table (for each user, their score and points per completed league)
  const leagueResults = completedLeagues.map((league) => {
    const scores = scoreList.filter((s) => s.league_id === league.id)
    return {
      league,
      scores,
    }
  })

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <SeriesHeader name={series.name} year={series.year} />

      <div className="max-w-4xl mx-auto p-6 space-y-8">

        {/* Season Standings */}
        <div>
          <h2 className="text-lg font-bold text-gray-100 mb-3">Season Standings</h2>
          {completedLeagues.length === 0 ? (
            <p className="text-sm text-gray-500">No completed tournaments yet — standings will appear here once a tournament finishes.</p>
          ) : (
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-3 w-8">#</th>
                    <th className="text-left px-4 py-3">Team</th>
                    {completedLeagues.map((l) => (
                      <th key={l.id} className="text-center px-3 py-3 font-medium">
                        <Link href={`/dashboard/${l.id}`} className="hover:text-blue-400 transition-colors">
                          {l.tournaments?.name ?? l.name}
                        </Link>
                      </th>
                    ))}
                    <th className="text-right px-4 py-3 text-yellow-500">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s, i) => {
                    const rank = (s as any).rank
                    const isLeader = rank === 1
                    return (
                      <tr key={s.user_id} className={`border-b border-gray-800 last:border-0 ${isLeader ? 'bg-yellow-950/30' : 'hover:bg-gray-800/50'}`}>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{rank}</td>
                        <td className={`px-4 py-3 font-medium ${isLeader ? 'text-yellow-300' : 'text-gray-100'}`}>
                          {isLeader && <span className="mr-1">🏆</span>}
                          {s.display_name}
                        </td>
                        {completedLeagues.map((league) => {
                          const score = scoreList.find((sc) => sc.league_id === league.id && sc.user_id === s.user_id)
                          // Compute points for this user in this league
                          const leagueScores = scoreList.filter((sc) => sc.league_id === league.id)
                          const tiedUsers = score?.rank !== null && score?.rank !== undefined
                            ? leagueScores.filter((sc) => sc.rank === score.rank)
                            : []
                          const positions = tiedUsers.map((_, idx) => (score?.rank ?? 0) + idx)
                          const pts = tiedUsers.length > 1
                            ? Math.round(positions.reduce((sum, p) => sum + positionPoints(p), 0) / tiedUsers.length)
                            : positionPoints(score?.rank ?? null)

                          return (
                            <td key={league.id} className="px-3 py-3 text-center">
                              {score ? (
                                <div>
                                  <span className={`text-xs tabular-nums font-mono ${scoreClass(score.total_strokes)}`}>
                                    {fmtScore(score.total_strokes)}
                                  </span>
                                  <span className="text-gray-600 text-xs ml-1">({pts})</span>
                                </div>
                              ) : (
                                <span className="text-gray-700">—</span>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-4 py-3 text-right font-bold text-yellow-400 tabular-nums">{s.points}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Active / Upcoming Leagues */}
        {(liveLeagues.length > 0 || upcomingLeagues.length > 0) && (
          <div>
            <h2 className="text-lg font-bold text-gray-100 mb-3">Tournaments</h2>
            <div className="space-y-3">
              {[...liveLeagues, ...upcomingLeagues].map((league) => (
                <div key={league.id} className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-100">{league.name}</p>
                    <p className="text-sm text-gray-500">{league.tournaments?.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {league.status === 'live' && (
                      <Link href={`/dashboard/${league.id}`} className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded-lg font-medium transition-colors">
                        Leaderboard
                      </Link>
                    )}
                    {league.status === 'drafting' && (
                      <Link href={`/draft/${league.id}`} className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-sm rounded-lg font-medium transition-colors">
                        Draft Room
                      </Link>
                    )}
                    <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                      league.status === 'live' ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'
                    }`}>
                      {league.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Points system key */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Points System</p>
          <div className="flex gap-4 flex-wrap text-xs text-gray-400">
            {[['1st', 10], ['2nd', 7], ['3rd', 5], ['4th', 4], ['5th', 3], ['6th', 2], ['7th+', 1]].map(([pos, pts]) => (
              <span key={pos}><span className="text-gray-300 font-medium">{pos}</span> = {pts} pts</span>
            ))}
            <span className="text-gray-600">· Ties split points</span>
          </div>
        </div>

      </div>
    </div>
  )
}

function SeriesHeader({ name, year }: { name: string; year: number | null }) {
  return (
    <div className="bg-gray-900 border-b border-gray-800 px-6 py-5">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-400 transition-colors">← Home</Link>
          <h1 className="text-2xl font-bold text-green-400 mt-1">
            ⛳ {name}{year ? ` · ${year}` : ''}
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Season standings</p>
        </div>
      </div>
    </div>
  )
}
