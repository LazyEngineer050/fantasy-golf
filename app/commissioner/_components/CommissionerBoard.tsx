'use client'

import { useState, useTransition } from 'react'
import { saveDraft, deleteTeam, removePlayerPick, addPlayerToTeam, renameTeam } from '@/app/actions/commissioner'
import type { CutPlayer } from '@/app/actions/commissioner'
import type { ExistingTeam } from '@/app/commissioner/page'

interface League {
  id: string
  name: string
  status: 'drafting' | 'live' | 'completed'
  tournamentId: string
  tournamentName: string
}

interface Team {
  id: string
  name: string
  players: CutPlayer[]
}

let _teamIdCounter = 0
function newTeamId() { return `team-${++_teamIdCounter}` }

const inputCls = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-green-500'

export default function CommissionerBoard({
  leagues,
  cutPlayers,
  existingTeamsByLeague,
}: {
  leagues: League[]
  cutPlayers: CutPlayer[]
  existingTeamsByLeague: Record<string, ExistingTeam[]>
}) {
  const [view, setView] = useState<'draft' | 'manage'>('draft')
  const [selectedLeagueId, setSelectedLeagueId] = useState(leagues[0]?.id ?? '')

  const selectedLeague = leagues.find((l) => l.id === selectedLeagueId)
  const existingTeams = existingTeamsByLeague[selectedLeagueId] ?? []

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* League selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-wrap items-end gap-4">
        <div className="space-y-1 flex-1 min-w-48">
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">League</label>
          {leagues.length === 0 ? (
            <p className="text-sm text-yellow-400">No leagues found — create one in <a href="/admin" className="underline">Admin</a> first.</p>
          ) : (
            <select
              value={selectedLeagueId}
              onChange={(e) => setSelectedLeagueId(e.target.value)}
              className={`${inputCls} w-full`}
            >
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>{l.name} ({l.tournamentName})</option>
              ))}
            </select>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={() => setView('draft')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === 'draft' ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-100'}`}
          >
            New Draft
          </button>
          <button
            onClick={() => setView('manage')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === 'manage' ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-100'}`}
          >
            Manage Teams
            {existingTeams.length > 0 && (
              <span className="ml-1.5 bg-blue-900 text-blue-300 text-xs px-1.5 py-0.5 rounded-full">{existingTeams.length}</span>
            )}
          </button>
        </div>
      </div>

      {view === 'draft' ? (
        <DraftView
          selectedLeague={selectedLeague ?? null}
          leagues={leagues}
          cutPlayers={cutPlayers}
        />
      ) : (
        <ManageView
          selectedLeague={selectedLeague ?? null}
          existingTeams={existingTeams}
          cutPlayers={cutPlayers}
        />
      )}
    </div>
  )
}

// ─── Draft View ───────────────────────────────────────────────────────────────

function DraftView({
  selectedLeague,
  leagues,
  cutPlayers,
}: {
  selectedLeague: { id: string; name: string; tournamentId: string; tournamentName: string } | null
  leagues: { id: string }[]
  cutPlayers: CutPlayer[]
}) {
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedPlayer, setSelectedPlayer] = useState<CutPlayer | null>(null)
  const [search, setSearch] = useState('')
  const [filterCutOnly, setFilterCutOnly] = useState(true)
  const [newTeamName, setNewTeamName] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const [isPending, startTransition] = useTransition()

  const assignedIds = new Set(teams.flatMap((t) => t.players.map((p) => p.espnPlayerId)))

  const availablePlayers = cutPlayers
    .filter((p) => !assignedIds.has(p.espnPlayerId))
    .filter((p) => !filterCutOnly || p.madeCut)
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))

  function addTeam() {
    const name = newTeamName.trim()
    if (!name) return
    setTeams((prev) => [...prev, { id: newTeamId(), name, players: [] }])
    setNewTeamName('')
  }

  function removeTeam(teamId: string) {
    setTeams((prev) => prev.filter((t) => t.id !== teamId))
  }

  function assignPlayer(teamId: string) {
    if (!selectedPlayer) return
    setTeams((prev) =>
      prev.map((t) => {
        if (t.id !== teamId) return t
        if (t.players.length >= 4) return t
        if (t.players.find((p) => p.espnPlayerId === selectedPlayer.espnPlayerId)) return t
        return { ...t, players: [...t.players, selectedPlayer] }
      })
    )
    setSelectedPlayer(null)
  }

  function removePlayer(teamId: string, espnPlayerId: string) {
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId
          ? { ...t, players: t.players.filter((p) => p.espnPlayerId !== espnPlayerId) }
          : t
      )
    )
  }

  function handleSave() {
    if (!selectedLeague) { setSaveError('Select a league first'); return }
    if (teams.length === 0) { setSaveError('Add at least one team'); return }
    setSaveError(null)
    setSavedOk(false)
    startTransition(async () => {
      const result = await saveDraft(
        selectedLeague.id,
        selectedLeague.tournamentId,
        teams.map((t) => ({ name: t.name, players: t.players }))
      )
      if (result?.error) setSaveError(result.error)
      else setSavedOk(true)
    })
  }

  const totalAssigned = teams.reduce((n, t) => n + t.players.length, 0)

  return (
    <div className="space-y-6">
      {/* Save bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-wrap items-center gap-4">
        <p className="text-sm text-gray-400">
          {teams.length} team{teams.length !== 1 ? 's' : ''} · {totalAssigned} player{totalAssigned !== 1 ? 's' : ''} assigned
        </p>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="ml-auto px-5 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white font-semibold text-sm rounded-lg transition-colors"
        >
          {isPending ? 'Saving…' : 'Save Draft'}
        </button>
        {saveError && (
          <p className="w-full text-red-400 text-sm font-medium bg-red-950 border border-red-800 rounded-lg px-3 py-2">
            ✗ {saveError}
          </p>
        )}
        {savedOk && (
          <p className="w-full text-green-400 text-sm font-medium bg-green-950 border border-green-800 rounded-lg px-3 py-2">
            ✓ Draft saved! League is now live.{' '}
            {selectedLeague && (
              <a href={`/dashboard/${selectedLeague.id}`} className="underline">View leaderboard →</a>
            )}
          </p>
        )}
        {!savedOk && teams.length > 0 && teams.some(t => t.players.length > 0 && t.players.length < 4) && (
          <p className="w-full text-yellow-500 text-xs">
            Tip: teams with fewer than 4 players will still be saved.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Left: Player Pool ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-bold text-gray-100">
              Players
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({availablePlayers.length} shown · {assignedIds.size} assigned)
              </span>
            </h2>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filterCutOnly}
                onChange={(e) => setFilterCutOnly(e.target.checked)}
                className="w-4 h-4 accent-green-500"
              />
              <span className="text-sm text-gray-300">Made the cut only</span>
              <span className="text-xs text-gray-500">
                ({cutPlayers.filter(p => p.madeCut).length} of {cutPlayers.length})
              </span>
            </label>
          </div>

          <input
            type="text"
            placeholder="Search players…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputCls} w-full`}
          />

          {selectedPlayer && (
            <div className="flex items-center justify-between bg-green-900 border border-green-700 rounded-lg px-3 py-2 text-sm">
              <span className="text-green-200 font-medium">Selected: {selectedPlayer.name}</span>
              <button onClick={() => setSelectedPlayer(null)} className="text-green-500 hover:text-green-300 text-xs">
                Deselect
              </button>
            </div>
          )}

          <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
            {availablePlayers.length === 0 && (
              <p className="text-center text-gray-600 text-sm py-6">
                {assignedIds.size === cutPlayers.length ? 'All players assigned!' : 'No players match your search'}
              </p>
            )}
            {availablePlayers.map((player) => {
              const isSelected = selectedPlayer?.espnPlayerId === player.espnPlayerId
              return (
                <button
                  key={player.espnPlayerId}
                  onClick={() => setSelectedPlayer(isSelected ? null : player)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'border-green-500 bg-green-900/40 text-green-200'
                      : player.madeCut
                      ? 'border-gray-700 bg-gray-800 hover:border-gray-500 text-gray-100'
                      : 'border-gray-800 bg-gray-900 hover:border-gray-600 text-gray-400'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{player.name}</span>
                    {!player.madeCut && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-900 text-red-400 font-medium">CUT</span>
                    )}
                  </div>
                  <div className="text-right text-xs text-gray-400">
                    {player.position && <span className="mr-2">{player.position}</span>}
                    {player.totalStrokes != null && <span>{player.totalStrokes}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Right: Teams ── */}
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-100">Teams</h2>

          {/* Add team */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Team name…"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTeam()}
              maxLength={40}
              className={`${inputCls} flex-1`}
            />
            <button
              onClick={addTeam}
              disabled={!newTeamName.trim()}
              className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-sm rounded-lg font-medium transition-colors"
            >
              Add Team
            </button>
          </div>

          {teams.length === 0 && (
            <p className="text-gray-600 text-sm text-center py-6">No teams yet — add one above.</p>
          )}

          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {teams.map((team) => {
              const isFull = team.players.length >= 4
              const canReceive = selectedPlayer && !isFull

              return (
                <div
                  key={team.id}
                  onClick={() => canReceive && assignPlayer(team.id)}
                  className={`rounded-xl border p-4 transition-colors ${
                    canReceive
                      ? 'border-green-500 bg-green-950/30 cursor-pointer hover:bg-green-950/50'
                      : 'border-gray-700 bg-gray-900'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold text-gray-100">{team.name}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">{team.players.length}/4</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeTeam(team.id) }}
                        className="text-xs text-red-600 hover:text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {team.players.map((player, i) => (
                      <div
                        key={player.espnPlayerId}
                        className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-sm text-gray-100">
                          <span className="text-gray-600 text-xs mr-2">R{i + 1}</span>
                          {player.name}
                        </span>
                        <button
                          onClick={() => removePlayer(team.id, player.espnPlayerId)}
                          className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {Array.from({ length: 4 - team.players.length }).map((_, i) => (
                      <div
                        key={`empty-${i}`}
                        className={`flex items-center px-3 py-2 rounded-lg border border-dashed text-xs ${
                          canReceive
                            ? 'border-green-600 text-green-600'
                            : 'border-gray-700 text-gray-700'
                        }`}
                      >
                        {canReceive ? `Click to assign ${selectedPlayer!.name}` : `Round ${team.players.length + i + 1} — empty`}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── Manage View ──────────────────────────────────────────────────────────────

function ManageView({
  selectedLeague,
  existingTeams,
  cutPlayers,
}: {
  selectedLeague: { id: string; tournamentId: string } | null
  existingTeams: ExistingTeam[]
  cutPlayers: CutPlayer[]
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Per-team state: which team is open for adding a player
  const [addingToUserId, setAddingToUserId] = useState<string | null>(null)
  const [addSearch, setAddSearch] = useState('')
  const [filterCutOnly, setFilterCutOnly] = useState(true)

  // Per-team rename state
  const [renamingUserId, setRenamingUserId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Track local team state so UI reflects changes without full reload
  const [teams, setTeams] = useState<ExistingTeam[]>(existingTeams)

  // Sync if parent re-renders (league switch)
  // We can't use useEffect safely here without deps; just use key on league instead (handled via key prop on ManageView in parent)

  function notify(msg: string, isError = false) {
    setError(isError ? msg : null)
    setSuccess(isError ? null : msg)
    setTimeout(() => { setError(null); setSuccess(null) }, 3000)
  }

  function handleDeleteTeam(userId: string, displayName: string) {
    if (!selectedLeague) return
    if (!confirm(`Delete team "${displayName}"? This cannot be undone.`)) return
    startTransition(async () => {
      const res = await deleteTeam(selectedLeague.id, userId)
      if (res?.error) { notify(res.error, true); return }
      setTeams((prev) => prev.filter((t) => t.userId !== userId))
      notify(`Team "${displayName}" deleted.`)
    })
  }

  function handleRemovePick(userId: string, pickId: string, playerName: string) {
    if (!selectedLeague) return
    startTransition(async () => {
      const res = await removePlayerPick(selectedLeague.id, pickId)
      if (res?.error) { notify(res.error, true); return }
      setTeams((prev) =>
        prev.map((t) =>
          t.userId !== userId ? t : { ...t, picks: t.picks.filter((p) => p.pickId !== pickId) }
        )
      )
      notify(`Removed ${playerName}.`)
    })
  }

  function handleAddPlayer(userId: string, player: CutPlayer) {
    if (!selectedLeague) return
    startTransition(async () => {
      const res = await addPlayerToTeam(selectedLeague.id, userId, selectedLeague.tournamentId, player)
      if ('error' in res) { notify(res.error, true); return }
      // Optimistic local update — real round number assigned by server, approximate here
      const team = teams.find((t) => t.userId === userId)
      const nextRound = (team?.picks.length ?? 0) + 1
      setTeams((prev) =>
        prev.map((t) =>
          t.userId !== userId ? t : {
            ...t,
            picks: [...t.picks, {
              pickId: `tmp-${Date.now()}`,
              playerId: player.espnPlayerId,
              espnPlayerId: player.espnPlayerId,
              playerName: player.name,
              round: nextRound,
            }],
          }
        )
      )
      setAddingToUserId(null)
      setAddSearch('')
      notify(`Added ${player.name}.`)
    })
  }

  function handleRename(userId: string) {
    if (!selectedLeague || !renameValue.trim()) return
    startTransition(async () => {
      const res = await renameTeam(selectedLeague.id, userId, renameValue)
      if (res?.error) { notify(res.error, true); return }
      setTeams((prev) =>
        prev.map((t) =>
          t.userId !== userId ? t : { ...t, displayName: renameValue.trim() }
        )
      )
      setRenamingUserId(null)
      setRenameValue('')
      notify('Team renamed.')
    })
  }

  if (!selectedLeague) {
    return <p className="text-gray-500 text-sm text-center py-10">Select a league to manage its teams.</p>
  }

  if (teams.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-sm">No teams in this league yet.</p>
        <p className="text-xs mt-1">Use the <span className="text-green-400">New Draft</span> tab to add them.</p>
      </div>
    )
  }

  // Players already on any team (by espnPlayerId)
  const assignedEspnIds = new Set(
    teams.flatMap((t) => t.picks.map((p) => p.espnPlayerId).filter(Boolean) as string[])
  )

  const addCandidates = cutPlayers
    .filter((p) => !assignedEspnIds.has(p.espnPlayerId))
    .filter((p) => !filterCutOnly || p.madeCut)
    .filter((p) => addSearch === '' || p.name.toLowerCase().includes(addSearch.toLowerCase()))

  return (
    <div className="space-y-4">
      {(error || success) && (
        <p className={`text-sm font-medium rounded-lg px-3 py-2 border ${
          error ? 'text-red-400 bg-red-950 border-red-800' : 'text-green-400 bg-green-950 border-green-800'
        }`}>
          {error ?? success}
        </p>
      )}

      {teams.map((team) => {
        const isAddingHere = addingToUserId === team.userId
        const isRenamingHere = renamingUserId === team.userId

        return (
          <div key={team.userId} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
              {isRenamingHere ? (
                <div className="flex gap-2 flex-1">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(team.userId); if (e.key === 'Escape') setRenamingUserId(null) }}
                    maxLength={40}
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    onClick={() => handleRename(team.userId)}
                    disabled={isPending || !renameValue.trim()}
                    className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-xs rounded-lg font-medium"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setRenamingUserId(null)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-100 truncate">{team.displayName}</h3>
                  <span className="text-xs text-gray-500 shrink-0">{team.picks.length}/4</span>
                  <button
                    onClick={() => { setRenamingUserId(team.userId); setRenameValue(team.displayName) }}
                    className="text-xs text-gray-500 hover:text-blue-400 transition-colors shrink-0"
                  >
                    Rename
                  </button>
                </div>
              )}

              {!isRenamingHere && (
                <button
                  onClick={() => handleDeleteTeam(team.userId, team.displayName)}
                  disabled={isPending}
                  className="text-xs text-red-700 hover:text-red-400 disabled:opacity-40 shrink-0 transition-colors"
                >
                  Delete Team
                </button>
              )}
            </div>

            {/* Picks */}
            <div className="space-y-1.5">
              {team.picks.length === 0 && (
                <p className="text-xs text-gray-600 px-1">No players yet.</p>
              )}
              {team.picks.map((pick) => (
                <div
                  key={pick.pickId}
                  className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2"
                >
                  <span className="text-sm text-gray-100">
                    <span className="text-gray-600 text-xs mr-2">R{pick.round}</span>
                    {pick.playerName}
                  </span>
                  <button
                    onClick={() => handleRemovePick(team.userId, pick.pickId, pick.playerName)}
                    disabled={isPending}
                    className="text-xs text-gray-600 hover:text-red-400 disabled:opacity-40 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {/* Empty slots */}
              {Array.from({ length: Math.max(0, 4 - team.picks.length) }).map((_, i) => (
                <div
                  key={`empty-${i}`}
                  className="flex items-center px-3 py-2 rounded-lg border border-dashed border-gray-700 text-xs text-gray-700"
                >
                  Round {team.picks.length + i + 1} — empty
                </div>
              ))}
            </div>

            {/* Add player toggle */}
            {team.picks.length < 4 && (
              <div>
                {!isAddingHere ? (
                  <button
                    onClick={() => { setAddingToUserId(team.userId); setAddSearch('') }}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    + Add player
                  </button>
                ) : (
                  <div className="space-y-2 pt-1">
                    <div className="flex gap-2 items-center">
                      <input
                        autoFocus
                        type="text"
                        placeholder="Search players…"
                        value={addSearch}
                        onChange={(e) => setAddSearch(e.target.value)}
                        className={`${inputCls} flex-1`}
                      />
                      <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
                        <input
                          type="checkbox"
                          checked={filterCutOnly}
                          onChange={(e) => setFilterCutOnly(e.target.checked)}
                          className="w-3.5 h-3.5 accent-green-500"
                        />
                        <span className="text-xs text-gray-400">Cut only</span>
                      </label>
                      <button
                        onClick={() => { setAddingToUserId(null); setAddSearch('') }}
                        className="text-xs text-gray-500 hover:text-gray-300 shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {addCandidates.length === 0 && (
                        <p className="text-xs text-gray-600 py-2 text-center">No available players</p>
                      )}
                      {addCandidates.map((p) => (
                        <button
                          key={p.espnPlayerId}
                          onClick={() => handleAddPlayer(team.userId, p)}
                          disabled={isPending}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-gray-700 bg-gray-800 hover:border-blue-500 text-left text-sm text-gray-100 disabled:opacity-40 transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            {p.name}
                            {!p.madeCut && (
                              <span className="text-xs px-1 py-0.5 rounded bg-red-900 text-red-400">CUT</span>
                            )}
                          </span>
                          <span className="text-xs text-gray-500">{p.position ?? ''}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
