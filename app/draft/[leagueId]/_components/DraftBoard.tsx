'use client'

import { useState, useEffect, useTransition } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { submitPick } from '@/app/actions/draft'
import { fetchScoreboardPayload } from '@/lib/espn-browser'
import type {
  AvailablePlayer,
  DraftStateWithMembers,
  PickWithPlayer,
} from '@/lib/types'

interface Props {
  leagueId: string
  leagueName: string
  tournamentId: string
  tournamentName: string
  leagueStatus: 'drafting' | 'live' | 'completed'
  currentUserId: string | null
  draftState: DraftStateWithMembers | null
  picks: PickWithPlayer[]
  myPicks: PickWithPlayer[]
  availablePlayers: AvailablePlayer[]
  members: Array<{ user_id: string; draft_position: number; display_name: string }>
}

// Set user_id cookie client-side so the page re-renders with the right identity
async function claimIdentity(userId: string) {
  await fetch('/api/identify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  })
  window.location.reload()
}

export default function DraftBoard({
  leagueId,
  leagueName,
  tournamentId,
  tournamentName,
  leagueStatus,
  currentUserId,
  draftState: initialState,
  picks: initialPicks,
  myPicks: initialMyPicks,
  availablePlayers: initialAvailable,
  members,
}: Props) {
  const [draftState, setDraftState] = useState(initialState)
  const [picks, setPicks] = useState(initialPicks)
  const [available, setAvailable] = useState(initialAvailable)
  const [search, setSearch] = useState('')
  const [madeCutOnly, setMadeCutOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const isOnClock = draftState?.on_clock_user_id === currentUserId

  // The player pool comes from an ESPN ingest. If the server could not reach ESPN
  // the pool arrives empty — fetch the scoreboard here and hand it to the server,
  // then pull the freshly ingested pool.
  const [poolLoading, setPoolLoading] = useState(initialAvailable.length === 0)
  useEffect(() => {
    if (initialAvailable.length > 0) return
    let cancelled = false
    ;(async () => {
      const scoreboard = await fetchScoreboardPayload()
      if (scoreboard != null) {
        await fetch('/api/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tournamentId, scoreboard }),
        }).catch(() => {})
      }
      const res = await fetch(`/api/draft-pool?leagueTournamentId=${leagueId}`).catch(() => null)
      if (cancelled || !res?.ok) { if (!cancelled) setPoolLoading(false); return }
      const data: { players: AvailablePlayer[] } = await res.json()
      setAvailable(data.players)
      setPoolLoading(false)
    })()
    return () => { cancelled = true }
  }, [initialAvailable.length, leagueId, tournamentId])

  // Supabase Realtime subscriptions
  useEffect(() => {
    const supabase = getSupabaseBrowserClient()

    const channel = supabase
      .channel(`draft:${leagueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'draft_state', filter: `league_tournament_id=eq.${leagueId}` },
        (payload) => {
          if (payload.new) {
            setDraftState((prev) =>
              prev ? { ...prev, ...(payload.new as any) } : prev
            )
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'picks', filter: `league_tournament_id=eq.${leagueId}` },
        (payload) => {
          const newPick = payload.new as any
          setAvailable((prev) => {
            const picked = prev.find((p) => p.id === newPick.player_id)
            setPicks((cur) => [...cur, { ...newPick, player_name: picked?.name ?? '?' }])
            return prev.filter((p) => p.id !== newPick.player_id)
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [leagueId])

  function handlePick(playerId: string) {
    if (!isOnClock || isPending) return
    setError(null)
    startTransition(async () => {
      const result = await submitPick(leagueId, playerId)
      if (result?.error) setError(result.error)
    })
  }

  const filteredAvailable = available.filter((p) => {
    if (madeCutOnly && p.status !== 'active') return false
    return p.name.toLowerCase().includes(search.toLowerCase())
  })

  const myPicks = picks.filter((p) => p.user_id === currentUserId)

  const onClockMember = members.find((m) => m.user_id === draftState?.on_clock_user_id)
  const isDraftComplete = (draftState?.round ?? 0) > 4 || leagueStatus !== 'drafting'

  const isIdentified = currentUserId && members.some((m) => m.user_id === currentUserId)

  // Join screen — show when not yet identified as a league member
  if (!isIdentified) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-sm space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-green-400">{leagueName}</h1>
            <p className="text-gray-400 text-sm mt-1">{tournamentName} · Live Draft</p>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-300">Who are you?</p>
            {members.map((m) => (
              <button
                key={m.user_id}
                onClick={() => claimIdentity(m.user_id)}
                className="w-full text-left px-4 py-3 bg-gray-800 hover:bg-green-900/40 border border-gray-700 hover:border-green-600 rounded-xl text-gray-100 font-medium transition-colors"
              >
                {m.display_name}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <h1 className="text-2xl font-bold text-green-400">{leagueName}</h1>
        <p className="text-gray-400 text-sm mt-1">{tournamentName} · Post-Cut Snake Draft</p>
      </div>

      {/* On-clock banner */}
      {!isDraftComplete && (
        <div
          className={`px-6 py-3 text-center font-semibold text-sm ${
            isOnClock
              ? 'bg-green-600 text-white animate-pulse'
              : 'bg-gray-800 text-gray-300'
          }`}
        >
          {isOnClock
            ? '🟢 YOUR PICK — Round ' + draftState?.round
            : `⏳ Round ${draftState?.round} · Pick ${draftState?.pick_number} · Waiting on ${onClockMember?.display_name ?? '...'}`}
        </div>
      )}

      {isDraftComplete && (
        <div className="px-6 py-3 text-center bg-blue-800 text-white font-semibold text-sm">
          ✅ Draft Complete — league is now LIVE
        </div>
      )}

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-900 border border-red-700 rounded text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:gap-6 p-6">
        {/* Left: Available Players */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-gray-900 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-gray-100">Available Players</h2>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={madeCutOnly}
                  onChange={(e) => setMadeCutOnly(e.target.checked)}
                  className="w-4 h-4 accent-green-500"
                />
                <span className="text-sm text-gray-400">Made cut only</span>
              </label>
            </div>
            <input
              type="text"
              placeholder="Search players..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 mb-3 focus:outline-none focus:border-green-500"
            />
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {filteredAvailable.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-4">
                  {poolLoading ? 'Loading field from ESPN…' : 'No players found'}
                </p>
              )}
              {filteredAvailable.map((player) => (
                <div
                  key={player.id}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    isOnClock && !isPending
                      ? 'border-gray-700 bg-gray-800 hover:border-green-500 hover:bg-gray-750 cursor-pointer'
                      : 'border-gray-800 bg-gray-850 opacity-70 cursor-not-allowed'
                  }`}
                  onClick={() => handlePick(player.id)}
                >
                  <div>
                    <p className="font-medium text-sm text-gray-100">{player.name}</p>
                    <p className="text-xs text-gray-400">
                      {player.position ?? '—'} · Thru {player.thru ?? '—'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-green-400">
                      {player.total_strokes != null ? player.total_strokes : '—'}
                    </p>
                    {isOnClock && !isPending && (
                      <span className="text-xs text-gray-500">click to pick</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Draft Board Grid */}
          <div className="bg-gray-900 rounded-xl p-4">
            <h2 className="text-lg font-bold mb-3 text-gray-100">Draft Board</h2>
            <div
              className="grid gap-2 text-xs"
              style={{ gridTemplateColumns: `repeat(${members.length}, minmax(0, 1fr))` }}
            >
              {members.map((m) => (
                <div key={m.user_id} className="font-semibold text-center text-gray-300 pb-1 border-b border-gray-700">
                  {m.display_name}
                </div>
              ))}
              {[1, 2, 3, 4].map((round) =>
                members.map((m, idx) => {
                  const pick = picks.find(
                    (p) => p.round === round && p.user_id === m.user_id
                  )
                  return (
                    <div
                      key={`${round}-${m.user_id}`}
                      className={`p-2 rounded text-center min-h-10 ${
                        pick
                          ? 'bg-gray-800 text-gray-100'
                          : 'bg-gray-850 border border-dashed border-gray-700 text-gray-600'
                      } ${m.user_id === currentUserId ? 'ring-1 ring-green-700' : ''}`}
                    >
                      {pick ? pick.player_name : `R${round}`}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* Right: My Team */}
        <div className="space-y-4">
          <div className="bg-gray-900 rounded-xl p-4">
            <h2 className="text-lg font-bold mb-3 text-gray-100">My Team</h2>
            {myPicks.length === 0 ? (
              <p className="text-gray-500 text-sm">No picks yet</p>
            ) : (
              <div className="space-y-2">
                {myPicks.map((pick) => (
                  <div
                    key={pick.id}
                    className="p-3 bg-gray-800 rounded-lg border border-gray-700"
                  >
                    <p className="text-sm font-medium text-gray-100">{pick.player_name}</p>
                    <p className="text-xs text-gray-500">Round {pick.round} · Pick {pick.pick_number}</p>
                  </div>
                ))}
                {myPicks.length < 4 && (
                  <p className="text-xs text-gray-500 mt-2">
                    {4 - myPicks.length} pick{4 - myPicks.length !== 1 ? 's' : ''} remaining
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Order reminder */}
          <div className="bg-gray-900 rounded-xl p-4">
            <h2 className="text-sm font-bold mb-2 text-gray-400">Draft Order</h2>
            {members.map((m) => (
              <div
                key={m.user_id}
                className={`flex items-center gap-2 py-1.5 text-sm ${
                  m.user_id === draftState?.on_clock_user_id
                    ? 'text-green-400 font-semibold'
                    : 'text-gray-400'
                }`}
              >
                <span className="text-gray-600 text-xs w-4">{m.draft_position}.</span>
                {m.display_name}
                {m.user_id === draftState?.on_clock_user_id && (
                  <span className="ml-auto text-xs text-green-500">on clock</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
