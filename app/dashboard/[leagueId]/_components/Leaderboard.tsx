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
  const [view, setView] = useState<'teams' | 'players'>('teams')
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

  // Keep a ref to standings so the poll closure always sees the latest value
  const standingsRef = useRef(standings)
  useEffect(() => { standingsRef.current = standings }, [standings])

  // Poll every 30 seconds: refresh ESPN data, then fetch updated scores and push a snapshot.
  // This drives the fire/ice movement icons without needing Realtime.
  useEffect(() => {
    const poll = async () => {
      await fetch('/api/refresh', { method: 'POST' }).catch(() => {})

      type ScoreRow = { user_id: string; total_strokes: number | null; rank: number | null }
      const res = await fetch(`/api/scores?leagueId=${leagueId}`).catch(() => null)
      if (!res?.ok) return
      const fresh: ScoreRow[] = await res.json()

      setStandings((prev) => {
        const next = prev
          .map((s) => {
            const u = fresh.find((f) => f.user_id === s.user_id)
            return u ? { ...s, total_strokes: u.total_strokes, rank: u.rank } : s
          })
          .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
        pushScoreSnapshot(next)
        return next
      })
      setLastUpdate(new Date())
    }

    poll() // immediate on mount
    const interval = setInterval(poll, 30_000)
    return () => clearInterval(interval)
  }, [leagueId])

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
          <div className="text-right">
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
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-6">
        {view === 'players' ? (
          <PlayerBoard standings={standings} />
        ) : standings.length === 0 ? (
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

              // Current round = highest round number that has any data globally
              const roundKeys = [4, 3, 2, 1] as const
              const currentRound = roundKeys.find((r) =>
                standings.some((s) => s.picks.some((p) => p[`r${r}_strokes` as 'r1_strokes' | 'r2_strokes' | 'r3_strokes' | 'r4_strokes'] !== null))
              ) ?? null
              const colSpan = 3 // Player | Total | Active round

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
                            <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-full">Player</th>
                            <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Total</th>
                            {currentRound && (
                              <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap pr-4">R{currentRound}</th>
                            )}
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
                              const isLive = pick.thru && pick.thru !== 'F'
                              const currentRoundScore = currentRound
                                ? pick[`r${currentRound}_strokes` as 'r1_strokes' | 'r2_strokes' | 'r3_strokes' | 'r4_strokes']
                                : null

                              return (
                                <tr key={pick.player_id} className={`hover:bg-gray-800/50 transition-colors ${isOverallLeader ? 'bg-yellow-950/40' : 'bg-gray-900'}`}>
                                  {/* Player name then icons */}
                                  <td className="px-4 py-2.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className={`font-medium ${isOverallLeader ? 'text-yellow-300' : 'text-gray-100'}`}>
                                        {pick.player_name}
                                      </span>
                                      {isOverallLeader && <span title="Tournament leader" className="text-base leading-none">⭐</span>}
                                      {turdPlayerId === pick.player_id && <span title="Killing the team" className="text-base leading-none">💩</span>}
                                    </div>
                                  </td>
                                  {/* Total */}
                                  <td className={`px-3 py-2.5 text-center tabular-nums font-bold whitespace-nowrap ${scoreClass(pick.total_strokes)}`}>
                                    {fmtScore(pick.total_strokes)}
                                  </td>
                                  {/* Active round */}
                                  {currentRound && (
                                    <td className={`px-3 py-2.5 text-center whitespace-nowrap pr-4 ${isLive ? 'bg-green-950/30' : ''}`}>
                                      <div className={`tabular-nums font-medium ${scoreClass(currentRoundScore)}`}>
                                        {fmtScore(currentRoundScore)}
                                      </div>
                                      {isLive && (
                                        <div className="text-xs text-green-500 font-medium">
                                          {pick.thru === '0' ? 'Tee' : `Hole ${pick.thru}`}
                                        </div>
                                      )}
                                    </td>
                                  )}
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

// ─── Team colours (one per team, cycles if more than 8) ──────────────────────

const TEAM_COLORS = [
  { bg: 'bg-blue-900/60',   text: 'text-blue-300',   border: 'border-blue-700',   row: 'border-l-blue-500'   },
  { bg: 'bg-purple-900/60', text: 'text-purple-300', border: 'border-purple-700', row: 'border-l-purple-500' },
  { bg: 'bg-orange-900/60', text: 'text-orange-300', border: 'border-orange-700', row: 'border-l-orange-500' },
  { bg: 'bg-pink-900/60',   text: 'text-pink-300',   border: 'border-pink-700',   row: 'border-l-pink-500'   },
  { bg: 'bg-teal-900/60',   text: 'text-teal-300',   border: 'border-teal-700',   row: 'border-l-teal-500'   },
  { bg: 'bg-yellow-900/60', text: 'text-yellow-300', border: 'border-yellow-700', row: 'border-l-yellow-500' },
  { bg: 'bg-red-900/60',    text: 'text-red-300',    border: 'border-red-700',    row: 'border-l-red-500'    },
  { bg: 'bg-cyan-900/60',   text: 'text-cyan-300',   border: 'border-cyan-700',   row: 'border-l-cyan-500'   },
]

// ─── Player Board ─────────────────────────────────────────────────────────────

function PlayerBoard({ standings }: { standings: TeamStanding[] }) {
  // Build team → colour index map (stable: sorted by rank/index)
  const teamColorMap = new Map(
    standings.map((s, i) => [s.user_id, TEAM_COLORS[i % TEAM_COLORS.length]])
  )
  const ownerColorMap = new Map(
    standings.map((s, i) => [s.display_name, TEAM_COLORS[i % TEAM_COLORS.length]])
  )

  const allPicks = standings.flatMap((s) =>
    s.picks.map((p) => ({ ...p, owner: s.display_name, userId: s.user_id }))
  )

  const rows = allPicks
    .filter((p) => p.total_strokes !== null)
    .sort((a, b) => (a.total_strokes ?? 0) - (b.total_strokes ?? 0))

  const unstarted = allPicks.filter((p) => p.total_strokes === null)

  if (rows.length === 0 && unstarted.length === 0) {
    return <p className="text-center text-gray-500 py-12">No player scores yet.</p>
  }

  // Legend
  const teams = standings.map((s, i) => ({ name: s.display_name, color: TEAM_COLORS[i % TEAM_COLORS.length] }))

  return (
    <div className="space-y-4">
      {/* Team colour legend */}
      <div className="flex flex-wrap gap-2">
        {teams.map((t) => (
          <span key={t.name} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${t.color.bg} ${t.color.text} ${t.color.border}`}>
            {t.name}
          </span>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/80">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-8">Pos</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Player</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Today</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide pr-4">Thru</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {rows.map((p, i) => {
              const color = ownerColorMap.get(p.owner)
              return (
                <tr key={p.player_id} className={`hover:bg-gray-800/50 transition-colors border-l-4 ${color?.row ?? 'border-l-gray-700'}`}>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{p.position ?? i + 1}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-100">{p.player_name}</div>
                    <div className={`text-xs mt-0.5 ${color?.text ?? 'text-gray-500'}`}>{p.owner}</div>
                  </td>
                  <td className={`px-4 py-2.5 text-center tabular-nums font-bold ${scoreClass(p.total_strokes)}`}>
                    {fmtScore(p.total_strokes)}
                  </td>
                  <td className={`px-4 py-2.5 text-center tabular-nums ${scoreClass(p.today_strokes)}`}>
                    {fmtScore(p.today_strokes)}
                  </td>
                  <td className="px-4 py-2.5 text-center text-gray-400 text-xs pr-4">
                    {p.thru ?? '—'}
                  </td>
                </tr>
              )
            })}
            {unstarted.map((p) => {
              const color = ownerColorMap.get(p.owner)
              return (
                <tr key={p.player_id} className={`opacity-40 border-l-4 ${color?.row ?? 'border-l-gray-700'}`}>
                  <td className="px-4 py-2.5 text-gray-600 text-xs">—</td>
                  <td className="px-4 py-2.5">
                    <div className="text-gray-500">{p.player_name}</div>
                    <div className={`text-xs mt-0.5 ${color?.text ?? 'text-gray-600'}`}>{p.owner}</div>
                  </td>
                  <td className="px-4 py-2.5 text-center text-gray-600">—</td>
                  <td className="px-4 py-2.5 text-center text-gray-600">—</td>
                  <td className="px-4 py-2.5 text-center text-gray-600 pr-4">—</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
