'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { computeWinnings, DEFAULT_PAYOUT, type PayoutConfig } from '@/lib/winnings'
import type { TeamStanding } from '@/lib/types'

// Keep a rolling history of total_strokes snapshots (capped at 10 refreshes).
// Movement is determined by comparing current score to the oldest snapshot.
const HISTORY_CAP = 10

interface Props {
  leagueTournamentId: string
  tournamentName: string
  leagueStatus: 'drafting' | 'live' | 'completed'
  standings: TeamStanding[]
  currentUserId: string | null
  payoutConfig: PayoutConfig
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
  leagueTournamentId,
  tournamentName,
  leagueStatus,
  standings: initialStandings,
  currentUserId,
  payoutConfig,
}: Props) {
  const [standings, setStandings] = useState(initialStandings)
  const [status, setStatus] = useState(leagueStatus)
  const [view, setView] = useState<'teams' | 'players'>('teams')
  const [, forceRender] = useState(0)
  const statusRef = useRef(leagueStatus)
  const STORAGE_KEY = `score-history-${leagueTournamentId}`

  // scoreHistory[i] = { userId -> total_strokes } snapshot — persisted to localStorage
  const scoreHistory = useRef<Record<string, number>[]>([])
  // Derived movement map: userId -> 'up' | 'down' | null (recomputed after each snapshot)
  const movementMap = useRef<Record<string, 'up' | 'down' | null>>({})

  function recomputeMovement(history: Record<string, number>[], current: TeamStanding[]) {
    function assignByRank() {
      const scored = current.filter((s) => s.total_strokes != null)
      if (scored.length < 2) return
      const next: Record<string, 'up' | 'down' | null> = {}
      for (const s of scored) next[s.user_id] = null
      next[scored[0].user_id] = 'up'
      next[scored[scored.length - 1].user_id] = 'down'
      movementMap.current = next
    }

    if (history.length < 2) {
      assignByRank()
      return
    }

    const oldest = history[0]
    const latest = history[history.length - 1]
    const deltas: { userId: string; delta: number }[] = []

    for (const s of current) {
      const old = oldest[s.user_id]
      const now = latest[s.user_id]
      if (old != null && now != null) {
        deltas.push({ userId: s.user_id, delta: now - old })
      }
    }

    // No overlapping data (e.g. first snapshot was empty) — fall back to rank
    if (deltas.length === 0) { assignByRank(); return }

    // Always assign fire to the best (most negative delta) and ice to the worst (most positive)
    deltas.sort((a, b) => a.delta - b.delta)
    const hotId = deltas[0].userId
    const coldId = deltas[deltas.length - 1].userId

    const next: Record<string, 'up' | 'down' | null> = {}
    for (const { userId } of deltas) next[userId] = null
    next[hotId] = 'up'
    if (coldId !== hotId) next[coldId] = 'down'

    movementMap.current = next
  }

  function pushScoreSnapshot(current: TeamStanding[]) {
    const snapshot: Record<string, number> = {}
    for (const s of current) {
      if (s.total_strokes != null) snapshot[s.user_id] = s.total_strokes
    }
    const updated = [...scoreHistory.current, snapshot].slice(-HISTORY_CAP)
    scoreHistory.current = updated

    // Persist to localStorage
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)) } catch {}

    recomputeMovement(updated, current)
  }

  // Restore history from localStorage, then seed with initial server data
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, number>[]
        scoreHistory.current = parsed.slice(-HISTORY_CAP)
      }
    } catch {}
    pushScoreSnapshot(initialStandings)
    forceRender((n) => n + 1) // show fire/ice from rank-based fallback immediately
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function getMovement(userId: string): 'up' | 'down' | null {
    return movementMap.current[userId] ?? null
  }

  // Keep a ref to standings so the poll closure always sees the latest value
  const standingsRef = useRef(standings)
  useEffect(() => { standingsRef.current = standings }, [standings])

  // Poll every 30 seconds: refresh ESPN data, then fetch updated team + player scores.
  // This drives the fire/ice movement icons and keeps thru/tee_time current.
  // Stops automatically when the league is marked completed.
  useEffect(() => {
    const poll = async () => {
      if (statusRef.current === 'completed') return

      await fetch('/api/refresh', { method: 'POST' }).catch(() => {})

      type TeamRow = { user_id: string; total_strokes: number | null; rank: number | null }
      type PlayerRow = {
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
      const res = await fetch(`/api/scores?leagueTournamentId=${leagueTournamentId}`).catch(() => null)
      if (!res?.ok) return
      const fresh: { teams: TeamRow[]; players: PlayerRow[]; status: string | null } = await res.json()

      if (fresh.status === 'completed') {
        statusRef.current = 'completed'
        setStatus('completed')
      }

      const playerMap = new Map(fresh.players.map((p) => [p.player_id, p]))

      setStandings((prev) => {
        const next = prev
          .map((s) => {
            const t = fresh.teams.find((f) => f.user_id === s.user_id)
            return {
              ...s,
              total_strokes: t?.total_strokes ?? s.total_strokes,
              rank: t?.rank ?? s.rank,
              picks: s.picks.map((p) => {
                const ps = playerMap.get(p.player_id)
                return ps ? { ...p, ...ps } : p
              }),
            }
          })
          .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
        pushScoreSnapshot(next)
        return next
      })
    }

    poll() // immediate on mount
    const interval = setInterval(poll, 30_000)
    return () => clearInterval(interval)
  }, [leagueTournamentId])

  // Supabase Realtime subscription
  useEffect(() => {
    const supabase = getSupabaseBrowserClient()

    const channel = supabase
      .channel(`dashboard:${leagueTournamentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_scores', filter: `league_tournament_id=eq.${leagueTournamentId}` },
        (payload) => {
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
        })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [leagueTournamentId])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-2xl font-bold text-green-400">{tournamentName}</h1>
          <span className={`shrink-0 inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            status === 'live' ? 'bg-green-800 text-green-200'
            : status === 'completed' ? 'bg-yellow-800 text-yellow-200'
            : 'bg-yellow-900 text-yellow-200'
          }`}>
            {status === 'completed' ? 'FINAL' : status.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* View toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700 text-sm font-medium">
            <button
              onClick={() => setView('teams')}
              className={`px-3 py-1.5 transition-colors ${view === 'teams' ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-100'}`}
            >
              Teams
            </button>
            <button
              onClick={() => setView('players')}
              className={`px-3 py-1.5 transition-colors ${view === 'players' ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-100'}`}
            >
              Players
            </button>
          </div>
          <Link href="/standings" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-100 rounded-lg border border-gray-700 text-sm font-medium transition-colors">
            Standings
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-6">
        {status === 'completed' && standings.length > 0 && (
          <div className="mb-6 rounded-xl border border-yellow-500 bg-yellow-950 p-6 text-center shadow-lg shadow-yellow-900/30">
            <div className="text-5xl mb-3">🏆</div>
            <p className="text-xs font-semibold uppercase tracking-widest text-yellow-600 mb-1">Tournament Champion</p>
            <h2 className="text-3xl font-bold text-yellow-300 mb-1">{standings[0].display_name}</h2>
            <p className={`text-2xl font-bold tabular-nums ${scoreClass(standings[0].total_strokes)}`}>
              {fmtScore(standings[0].total_strokes)}
            </p>
            <p className="text-gray-500 text-xs mt-3">{tournamentName} · Final</p>
          </div>
        )}

        {view === 'players' ? (
          <PlayerBoard standings={standings} />
        ) : standings.length === 0 ? (
          <p className="text-center text-gray-500 py-12">
            No standings yet — scores will appear once the tournament is live.
          </p>
        ) : (
          <div className="space-y-6">
            {(() => {
              const winnings = computeWinnings(standings, payoutConfig)

              // Overall tournament leader
              const allPicks = standings.flatMap((s) => s.picks).filter((p) => p.total_strokes !== null)
              const bestScore = allPicks.length > 0 ? Math.min(...allPicks.map((p) => p.total_strokes!)) : null
              const overallLeaderPlayerIds = new Set(
                bestScore !== null ? allPicks.filter((p) => p.total_strokes === bestScore).map((p) => p.player_id) : []
              )

              // All played rounds, most recent first (only rounds with any data)
              const roundKeys = [4, 3, 2, 1] as const
              type RKey = 'r1_strokes' | 'r2_strokes' | 'r3_strokes' | 'r4_strokes'
              const playedRounds = roundKeys.filter((r) =>
                standings.some((s) => s.picks.some((p) => p[`r${r}_strokes` as RKey] !== null))
              )
              const currentRound = playedRounds[0] ?? null // highest round with data
              const colSpan = 2 + playedRounds.length

              // If any player has started today, use only started players (new round in progress).
              // Between rounds nobody has thru, so carry forward previous round scores instead.
              const anyStartedToday = allPicks.some((p) => p.thru !== null)
              const turdPicks = anyStartedToday
                ? allPicks.filter((p) => p.thru !== null && p.today_strokes !== null)
                : allPicks.filter((p) => p.today_strokes !== null)
              const allTodayScores = turdPicks.map((p) => p.today_strokes!)
              const fieldAvgToday = allTodayScores.length > 0
                ? allTodayScores.reduce((a, b) => a + b, 0) / allTodayScores.length
                : null

              // Turd sizing: compute globally so sizes are relative across all players
              // A player is a turd if: 3+ above field avg, OR field is under par and they're over,
              // OR they are the single worst player on the day among drafted players.
              const allTurdPicks = (() => {
                if (fieldAvgToday === null || turdPicks.length === 0) return []
                const threshold = turdPicks.filter((p) =>
                  p.today_strokes! >= fieldAvgToday + 3 ||
                  (p.today_strokes! > 0 && fieldAvgToday < 0)
                )
                const worstScore = Math.max(...turdPicks.map((p) => p.today_strokes!))
                const worstPlayers = turdPicks.filter((p) => p.today_strokes! === worstScore)
                const turdIds = new Set(threshold.map((p) => p.player_id))
                for (const wp of worstPlayers) {
                  if (!turdIds.has(wp.player_id)) threshold.push(wp)
                }
                return threshold
              })()
              const turdScores = allTurdPicks.map((p) => p.today_strokes!)
              const minTurd = turdScores.length > 0 ? Math.min(...turdScores) : 0
              const maxTurd = turdScores.length > 0 ? Math.max(...turdScores) : 0
              // Map player_id → font size string: best turd = 0.8rem, worst = 2rem
              const turdSizeMap = new Map<string, string>(
                allTurdPicks.map((p) => {
                  const t = maxTurd === minTurd ? 1 : (p.today_strokes! - minTurd) / (maxTurd - minTurd)
                  return [p.player_id, `${(0.8 + t * 1.2).toFixed(2)}rem`]
                })
              )

              return standings.map((team, idx) => {
                const leaderScore = standings[0]?.total_strokes
                const isLeader = team.total_strokes != null && leaderScore != null && team.total_strokes === leaderScore
                const isCurrentUser = team.user_id === currentUserId
                const movement = getMovement(team.user_id)
                // Sort by current score ascending; unscored players go to the bottom
                const picks = [...team.picks].sort((a, b) => {
                  if (a.total_strokes === null && b.total_strokes === null) return 0
                  if (a.total_strokes === null) return 1
                  if (b.total_strokes === null) return -1
                  return a.total_strokes - b.total_strokes
                })

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
                      {(() => {
                        const net = winnings.get(team.user_id)
                        if (net === undefined) return null
                        const positive = net > 0
                        const zero = net === 0
                        return (
                          <div className={`text-right shrink-0 pl-3 border-l border-gray-700 ${zero ? 'opacity-50' : ''}`}>
                            <span className={`text-lg font-bold tabular-nums ${positive ? 'text-green-400' : net < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                              {positive ? '+' : ''}{net % 1 === 0 ? `$${net}` : `$${net.toFixed(2)}`}
                            </span>
                            <p className="text-xs text-gray-500">proj.</p>
                          </div>
                        )
                      })()}
                    </div>

                    {/* Players table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-t border-gray-800 bg-gray-900/60">
                            <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-full">Player</th>
                            <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Total</th>
                            {playedRounds.map((r) => (
                              <th key={r} className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap last:pr-4">R{r}</th>
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
                              const isOverallLeader = overallLeaderPlayerIds.has(pick.player_id)
                              const isLive = pick.thru && pick.thru !== 'F'

                              const notStartedToday = !pick.thru && pick.tee_time

                              return (
                                <tr key={pick.player_id} className={`hover:bg-gray-800/50 transition-colors ${isOverallLeader ? 'bg-yellow-950/40' : 'bg-gray-900'}`}>
                                  {/* Player name then icons */}
                                  <td className="px-4 py-2.5 whitespace-nowrap">
                                    <div className="flex items-center gap-1.5">
                                      <span className={`font-medium ${isOverallLeader ? 'text-yellow-300' : 'text-gray-100'}`}>
                                        {pick.player_name}
                                      </span>
                                      {isOverallLeader && <span title="Tournament leader" className="text-base leading-none">⭐</span>}
                                      {turdSizeMap.has(pick.player_id) && <span title="Over par today" style={{ fontSize: turdSizeMap.get(pick.player_id) }} className="leading-none">💩</span>}
                                    </div>
                                  </td>
                                  {/* Total */}
                                  <td className={`px-3 py-2.5 text-center tabular-nums font-bold whitespace-nowrap ${scoreClass(pick.total_strokes)}`}>
                                    {fmtScore(pick.total_strokes)}
                                  </td>
                                  {/* All played rounds, most recent first */}
                                  {playedRounds.map((r, ri) => {
                                    const rawScore = pick[`r${r}_strokes` as RKey]
                                    const isActiveRound = r === currentRound && isLive
                                    // Hide score for the active round if player hasn't teed off yet
                                    // (ESPN returns 0/E as a placeholder before they start)
                                    const score = (r === currentRound && !pick.thru) ? null : rawScore
                                    const showTeeTime = r === currentRound && !!notStartedToday
                                    return (
                                      <td key={r} className={`px-3 py-2.5 text-center whitespace-nowrap ${ri === playedRounds.length - 1 ? 'pr-4' : ''} ${isActiveRound ? 'bg-green-950/30' : ''}`}>
                                        <div className={`tabular-nums font-medium ${scoreClass(score)}`}>
                                          {fmtScore(score)}
                                        </div>
                                        {isActiveRound && (
                                          <div className="text-xs text-green-500 font-medium">
                                            {pick.thru === '0' ? 'Tee' : `Hole ${pick.thru}`}
                                          </div>
                                        )}
                                        {showTeeTime && (
                                          <div className="text-xs text-gray-500 font-medium">
                                            {pick.tee_time}
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

// ─── Player Board ─────────────────────────────────────────────────────────────

function PlayerBoard({ standings }: { standings: TeamStanding[] }) {
  const allPicks = standings.flatMap((s) =>
    s.picks.map((p) => ({ ...p, owner: s.display_name }))
  )

  const rows = allPicks
    .filter((p) => p.total_strokes !== null)
    .sort((a, b) => (a.total_strokes ?? 0) - (b.total_strokes ?? 0))

  const unstarted = allPicks.filter((p) => p.total_strokes === null)

  const bestScore = rows.length > 0 ? rows[0].total_strokes : null

  if (rows.length === 0 && unstarted.length === 0) {
    return <p className="text-center text-gray-500 py-12">No player scores yet.</p>
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/80">
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-8">Pos</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Player</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Owner</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Today</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide pr-4">Thru</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/60">
          {rows.map((p, i) => {
            const isLeader = bestScore !== null && p.total_strokes === bestScore
            return (
            <tr key={p.player_id} className={`hover:bg-gray-800/50 transition-colors ${isLeader ? 'bg-yellow-950/40' : 'bg-gray-900'}`}>
              <td className="px-4 py-2.5 text-gray-500 text-xs">{p.position ?? i + 1}</td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <div className="flex items-center gap-1.5">
                  <span className={`font-medium ${isLeader ? 'text-yellow-300' : 'text-gray-100'}`}>{p.player_name}</span>
                  {isLeader && <span title="Tournament leader" className="text-base leading-none">⭐</span>}
                </div>
              </td>
              <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{p.owner}</td>
              <td className={`px-4 py-2.5 text-center tabular-nums font-bold ${isLeader ? 'text-yellow-300' : scoreClass(p.total_strokes)}`}>
                {fmtScore(p.total_strokes)}
              </td>
              <td className={`px-4 py-2.5 text-center tabular-nums ${scoreClass(p.thru ? p.today_strokes : null)}`}>
                {p.thru ? fmtScore(p.today_strokes) : '—'}
              </td>
              <td className="px-4 py-2.5 text-center text-gray-400 text-xs pr-4">{p.thru ?? (p.tee_time ?? '—')}</td>
            </tr>
            )
          })}
          {unstarted.map((p) => (
            <tr key={p.player_id} className="bg-gray-900 opacity-60">
              <td className="px-4 py-2.5 text-gray-600 text-xs">—</td>
              <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{p.player_name}</td>
              <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{p.owner}</td>
              <td className="px-4 py-2.5 text-center text-gray-600">—</td>
              <td className="px-4 py-2.5 text-center text-gray-600">—</td>
              <td className="px-4 py-2.5 text-center text-gray-500 text-xs pr-4 whitespace-nowrap">
                {p.tee_time ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
