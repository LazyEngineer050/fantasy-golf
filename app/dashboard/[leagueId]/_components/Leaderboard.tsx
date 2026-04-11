'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { TeamStanding } from '@/lib/types'

// Keep a rolling history of total_strokes snapshots (capped at 10 refreshes).
// Movement is determined by comparing current score to the oldest snapshot.
const HISTORY_CAP = 10

interface Props {
  leagueId: string
  leagueName: string
  tournamentName: string
  leagueStatus: 'drafting' | 'live' | 'completed'
  standings: TeamStanding[]
  currentUserId: string | null
  allLeagues: { id: string; name: string }[]
}

function fmtScore(n: number | null): string {
  if (n === null) return '—'
  if (n === 0) return 'E'
  return n > 0 ? `+${n}` : String(n)
}

function scoreClass(n: number | null): string {
  if (n === null) return 'text-gray-500'
  if (n < 0) return 'text-red-400'
  if (n > 0) return 'text-blue-400'
  return 'text-gray-300'
}

export default function Leaderboard({
  leagueId,
  leagueName,
  tournamentName,
  leagueStatus,
  standings: initialStandings,
  currentUserId,
  allLeagues,
}: Props) {
  const router = useRouter()
  const [standings, setStandings] = useState(initialStandings)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  // scoreHistory[i] = { userId -> total_strokes } snapshot
  const scoreHistory = useRef<Record<string, number>[]>([])

  function pushScoreSnapshot(current: TeamStanding[]) {
    const snapshot: Record<string, number> = {}
    for (const s of current) {
      if (s.total_strokes != null) snapshot[s.user_id] = s.total_strokes
    }
    scoreHistory.current = [...scoreHistory.current, snapshot].slice(-HISTORY_CAP)
  }

  // Seed history from initial server data
  useEffect(() => {
    pushScoreSnapshot(initialStandings)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function getMovement(userId: string, currentScore: number | null): 'up' | 'down' | null {
    if (currentScore == null || scoreHistory.current.length < 2) return null
    const oldest = scoreHistory.current[0][userId]
    if (oldest == null) return null
    // Score going down = improving = fire; score going up = worsening = cold
    if (currentScore < oldest) return 'up'
    if (currentScore > oldest) return 'down'
    return null
  }

  // Poll /api/refresh every 30 seconds to pull fresh ESPN scores into the DB.
  // Realtime subscriptions below then push the DB changes to the UI instantly.
  useEffect(() => {
    const poll = () => fetch('/api/refresh', { method: 'POST' }).catch(() => {})
    poll() // immediate on mount
    const interval = setInterval(poll, 30_000)
    return () => clearInterval(interval)
  }, [])

  // Supabase Realtime subscription
  useEffect(() => {
    const supabase = getSupabaseBrowserClient()

    const channel = supabase
      .channel(`dashboard:${leagueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_scores', filter: `league_id=eq.${leagueId}` },
        (payload) => {
          setLastUpdate(new Date())
          setStandings((prev) => {
            const updated = payload.new as { user_id: string; total_strokes: number | null; rank: number | null }
            const next = prev
              .map((s) =>
                s.user_id === updated.user_id
                  ? { ...s, total_strokes: updated.total_strokes, rank: updated.rank }
                  : s
              )
              .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
            pushScoreSnapshot(next)
            return next
          })
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_scores' }, () => {
        setLastUpdate(new Date())
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [leagueId])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          {allLeagues.length > 1 ? (
            <select
              value={leagueId}
              onChange={(e) => router.push(`/dashboard/${e.target.value}`)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-lg font-bold text-green-400 focus:outline-none focus:border-green-500 cursor-pointer"
            >
              {allLeagues.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          ) : (
            <h1 className="text-2xl font-bold text-green-400">{leagueName}</h1>
          )}
          <p className="text-gray-400 text-sm mt-1">{tournamentName}</p>
        </div>
        <div className="text-right shrink-0">
          <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
            leagueStatus === 'live' ? 'bg-green-800 text-green-200'
            : leagueStatus === 'completed' ? 'bg-gray-700 text-gray-300'
            : 'bg-yellow-900 text-yellow-200'
          }`}>
            {leagueStatus.toUpperCase()}
          </span>
          {lastUpdate && (
            <p className="text-xs text-gray-600 mt-1">Updated {lastUpdate.toLocaleTimeString()}</p>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-6">
        {standings.length === 0 ? (
          <p className="text-center text-gray-500 py-12">
            No standings yet — scores will appear once the tournament is live.
          </p>
        ) : (
          <div className="space-y-6">
            {(() => {
              // Overall tournament leader
              const allPicks = standings.flatMap((s) => s.picks).filter((p) => p.total_strokes !== null)
              const bestScore = allPicks.length > 0 ? Math.min(...allPicks.map((p) => p.total_strokes!)) : null
              const overallLeaderPlayerId = bestScore !== null
                ? allPicks.find((p) => p.total_strokes === bestScore)?.player_id
                : null

              // Which rounds have any data globally? Show most recent first, skip unplayed.
              const roundKeys = [4, 3, 2, 1] as const
              const activeRounds = roundKeys.filter((r) =>
                standings.some((s) => s.picks.some((p) => p[`r${r}_strokes` as 'r1_strokes' | 'r2_strokes' | 'r3_strokes' | 'r4_strokes'] !== null))
              )
              const colSpan = 2 + activeRounds.length // Total + Player + rounds

              return standings.map((team, idx) => {
                const isLeader = idx === 0 && team.total_strokes != null
                const isCurrentUser = team.user_id === currentUserId
                const movement = getMovement(team.user_id, team.total_strokes)
                const picks = [...team.picks].sort((a, b) => a.draft_round - b.draft_round)

                // Turd: worst current-round score on the team, only if over par today
                const todayPicks = picks.filter((p) => p.today_strokes !== null)
                const worstToday = todayPicks.length > 0 ? Math.max(...todayPicks.map((p) => p.today_strokes!)) : null
                const turdPlayerId = worstToday !== null && worstToday > 0
                  ? todayPicks.find((p) => p.today_strokes === worstToday)?.player_id
                  : null

                return (
                  <div
                    key={team.user_id}
                    className={`rounded-xl border overflow-hidden ${
                      isLeader ? 'border-yellow-500 shadow-lg shadow-yellow-900/20'
                      : isCurrentUser ? 'border-green-700'
                      : 'border-gray-800'
                    }`}
                  >
                    {/* Team header */}
                    <div className={`flex items-center gap-4 px-4 py-3 ${isLeader ? 'bg-yellow-950' : 'bg-gray-900'}`}>
                      <div className={`w-9 h-9 flex items-center justify-center rounded-full font-bold text-base shrink-0 ${
                        isLeader ? 'bg-yellow-500 text-gray-900' : 'bg-gray-800 text-gray-300'
                      }`}>
                        {isLeader ? '🏆' : (team.rank ?? '—')}
                      </div>
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <p className={`font-semibold truncate ${
                          isLeader ? 'text-yellow-300' : isCurrentUser ? 'text-green-300' : 'text-gray-100'
                        }`}>
                          {team.display_name}
                          {isCurrentUser && <span className="ml-2 text-xs text-gray-500 font-normal">(you)</span>}
                        </p>
                        {movement === 'up' && <span title="Moving up" className="text-xl leading-none animate-pulse">🔥</span>}
                        {movement === 'down' && <span title="Moving down" className="text-xl leading-none animate-pulse">🥶</span>}
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-2xl font-bold tabular-nums ${isLeader ? 'text-yellow-300' : scoreClass(team.total_strokes)}`}>
                          {fmtScore(team.total_strokes)}
                        </span>
                        <p className="text-xs text-gray-500">total</p>
                      </div>
                    </div>

                    {/* Players table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-t border-gray-800 bg-gray-900/60">
                            <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Total</th>
                            <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-full">Player</th>
                            {activeRounds.map((r) => (
                              <th key={r} className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">R{r}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/60">
                          {picks.length === 0 ? (
                            <tr>
                              <td colSpan={colSpan} className="px-4 py-3 text-gray-600 text-xs">No players drafted</td>
                            </tr>
                          ) : (
                            picks.map((pick) => {
                              const isOverallLeader = overallLeaderPlayerId === pick.player_id

                              // Which round is currently in progress for this player?
                              const liveRound = pick.thru && pick.thru !== 'F'
                                ? ([pick.r1_strokes, pick.r2_strokes, pick.r3_strokes, pick.r4_strokes]
                                    .reduce((last, s, i) => s !== null ? i + 1 : last, 0))
                                : null

                              const roundScore = (r: 1 | 2 | 3 | 4) =>
                                pick[`r${r}_strokes` as 'r1_strokes' | 'r2_strokes' | 'r3_strokes' | 'r4_strokes']

                              return (
                                <tr key={pick.player_id} className={`hover:bg-gray-800/50 transition-colors ${isOverallLeader ? 'bg-yellow-950/40' : 'bg-gray-900'}`}>
                                  {/* Total — 1st column */}
                                  <td className={`px-3 py-2.5 text-center tabular-nums font-bold whitespace-nowrap ${scoreClass(pick.total_strokes)}`}>
                                    {fmtScore(pick.total_strokes)}
                                  </td>
                                  {/* Player name with icons to the left */}
                                  <td className="px-4 py-2.5">
                                    <div className="flex items-center gap-1.5">
                                      {isOverallLeader && <span title="Tournament leader" className="text-base leading-none">⭐</span>}
                                      {turdPlayerId === pick.player_id && <span title="Killing the team" className="text-base leading-none">💩</span>}
                                      <span className="text-xs text-gray-600 font-medium">R{pick.draft_round}</span>
                                      <span className={`font-medium ${isOverallLeader ? 'text-yellow-300' : 'text-gray-100'}`}>
                                        {pick.player_name}
                                      </span>
                                    </div>
                                  </td>
                                  {/* Rounds: most recent first, only active ones */}
                                  {activeRounds.map((r) => {
                                    const score = roundScore(r)
                                    const isLive = liveRound === r
                                    return (
                                      <td key={r} className={`px-3 py-2.5 text-center whitespace-nowrap ${isLive ? 'bg-green-950/30' : ''}`}>
                                        <div className={`tabular-nums font-medium ${scoreClass(score)}`}>
                                          {fmtScore(score)}
                                        </div>
                                        {isLive && (
                                          <div className="text-xs text-green-500 font-medium">
                                            {pick.thru === '0' ? 'Tee' : `Hole ${pick.thru}`}
                                          </div>
                                        )}
                                      </td>
                                    )
                                  })}
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
