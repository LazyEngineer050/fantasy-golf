'use client'

import { useState, useTransition } from 'react'
import {
  ensureLeagueSeason,
  addLeagueSeasonMember,
  removeLeagueSeasonMember,
  createUser,
  saveDraft,
  removePlayerPick,
  addPlayerToTeam,
  renameTeam,
  completeLeagueTournament,
} from '@/app/actions/commissioner'
import type { CutPlayer } from '@/app/actions/commissioner'
import type {
  LeagueRow,
  SeasonRow,
  LeagueSeasonRow,
  LeagueTournamentRow,
  TournamentRow,
  UserRow,
  ExistingTeamPicks,
} from '@/app/commissioner/page'

interface Props {
  leagues: LeagueRow[]
  seasons: SeasonRow[]
  leagueSeasons: LeagueSeasonRow[]
  leagueTournaments: LeagueTournamentRow[]
  tournaments: TournamentRow[]
  users: UserRow[]
  cutPlayers: CutPlayer[]
  existingTeamsByLT: Record<string, ExistingTeamPicks[]>
  espnEventId: string | null
  espnEventName: string | null
}

const inputCls = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-green-500'
const btnCls = 'px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-sm rounded-lg font-medium transition-colors'

export default function CommissionerBoard({
  leagues: initialLeagues,
  seasons,
  leagueSeasons: initialLeagueSeasons,
  leagueTournaments: initialLTs,
  tournaments,
  users,
  cutPlayers,
  existingTeamsByLT,
  espnEventId,
  espnEventName,
}: Props) {
  const [selectedLeagueId, setSelectedLeagueId] = useState(initialLeagues[0]?.id ?? '')
  const [view, setView] = useState<'members' | 'draft' | 'manage'>('members')

  // Local state for optimistic updates (server revalidates on save)
  const [leagues, setLeagues] = useState(initialLeagues)
  const [leagueSeasons, setLeagueSeasons] = useState(initialLeagueSeasons)
  const [leagueTournaments] = useState(initialLTs)

  const selectedLeague = leagues.find((l) => l.id === selectedLeagueId)

  // Current season = most recent
  const currentSeason = seasons[0] ?? null

  // League season for selected league + current season
  const currentLS = currentSeason
    ? leagueSeasons.find((ls) => ls.leagueId === selectedLeagueId && ls.seasonId === currentSeason.id)
    : null

  // League tournaments for selected league (all seasons)
  const myLeagueTournaments = leagueTournaments.filter((lt) =>
    leagueSeasons.some((ls) => ls.id === lt.leagueSeasonId && ls.leagueId === selectedLeagueId)
  )

  // All tournament IDs already drafted for the selected league (any season)
  const draftedTournamentIds = new Set(myLeagueTournaments.map((lt) => lt.tournamentId))
  // Show all undrafted tournaments (not season-filtered so new tournaments always appear)
  const availableTournaments = tournaments.filter((t) => !draftedTournamentIds.has(t.id))

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* ── League selector ── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1 flex-1 min-w-48">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">League</label>
            {leagues.length === 0 ? (
              <p className="text-sm text-yellow-400">No leagues yet — create one below.</p>
            ) : (
              <select
                value={selectedLeagueId}
                onChange={(e) => { setSelectedLeagueId(e.target.value); setView('members') }}
                className={`${inputCls} w-full`}
              >
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            )}
          </div>

          {selectedLeague && (
            <div className="flex gap-2 ml-auto">
              {(['members', 'draft', 'manage'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition-colors ${
                    view === v ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-100'
                  }`}
                >
                  {v === 'draft' ? 'New Draft' : v === 'manage' ? `Manage (${myLeagueTournaments.length})` : 'Members'}
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ── Main view ── */}
      {selectedLeague && view === 'members' && (
        <MembersView
          league={selectedLeague}
          seasons={seasons}
          currentSeason={currentSeason}
          currentLS={currentLS ?? null}
          users={users}
          onLeagueSeasonCreated={(ls) => setLeagueSeasons((prev) => [...prev, ls])}
        />
      )}

      {selectedLeague && view === 'draft' && currentLS && (
        <DraftView
          leagueSeason={currentLS}
          availableTournaments={availableTournaments}
          currentSeason={currentSeason}
          cutPlayers={cutPlayers}
          espnEventId={espnEventId}
          espnEventName={espnEventName}
        />
      )}

      {selectedLeague && view === 'draft' && !currentLS && currentSeason && (
        <NoLeagueSeasonPrompt
          league={selectedLeague}
          season={currentSeason}
          onCreated={(ls) => { setLeagueSeasons((prev) => [...prev, ls]); setView('members') }}
        />
      )}

      {selectedLeague && view === 'manage' && (
        <ManageView
          leagueTournaments={myLeagueTournaments}
          leagueSeasons={leagueSeasons}
          existingTeamsByLT={existingTeamsByLT}
          cutPlayers={cutPlayers}
          tournaments={tournaments}
        />
      )}
    </div>
  )
}

// ─── No League Season Prompt ──────────────────────────────────────────────────

function NoLeagueSeasonPrompt({
  league,
  season,
  onCreated,
}: {
  league: LeagueRow
  season: SeasonRow
  onCreated: (ls: LeagueSeasonRow) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleCreate() {
    setError(null)
    startTransition(async () => {
      const res = await ensureLeagueSeason(league.id, season.id)
      if ('error' in res) { setError(res.error); return }
      onCreated({ id: res.id, leagueId: league.id, seasonId: season.id, members: [] })
    })
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center space-y-4">
      <p className="text-gray-300">
        <span className="font-semibold text-gray-100">{league.name}</span> doesn&apos;t have a {season.year} season yet.
      </p>
      <p className="text-sm text-gray-500">Creating one will copy members from the previous season (if any).</p>
      <button onClick={handleCreate} disabled={isPending} className={btnCls}>
        {isPending ? 'Creating…' : `Start ${season.year} Season`}
      </button>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}

// ─── Members View ─────────────────────────────────────────────────────────────

function MembersView({
  league,
  seasons,
  currentSeason,
  currentLS,
  users,
  onLeagueSeasonCreated,
}: {
  league: LeagueRow
  seasons: SeasonRow[]
  currentSeason: SeasonRow | null
  currentLS: LeagueSeasonRow | null
  users: UserRow[]
  onLeagueSeasonCreated: (ls: LeagueSeasonRow) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [members, setMembers] = useState(currentLS?.members ?? [])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [newMemberName, setNewMemberName] = useState('')
  const [addMode, setAddMode] = useState<'existing' | 'new'>('existing')

  const memberUserIds = new Set(members.map((m) => m.userId))
  const nonMembers = users.filter((u) => !memberUserIds.has(u.id))
  const nextPosition = members.length + 1

  function notify(msg: string, isError = false) {
    setError(isError ? msg : null)
    setSuccess(isError ? null : msg)
    setTimeout(() => { setError(null); setSuccess(null) }, 3000)
  }

  // If no current league_season, prompt to create one
  if (!currentLS) {
    if (!currentSeason) return <p className="text-gray-500 text-sm text-center py-8">No seasons available. Ask your system admin to set one up.</p>
    return (
      <NoLeagueSeasonPrompt
        league={league}
        season={currentSeason}
        onCreated={(ls) => { onLeagueSeasonCreated(ls); setMembers([]) }}
      />
    )
  }

  function handleRemove(userId: string, displayName: string) {
    if (!confirm(`Remove ${displayName} from the ${currentSeason?.year} season?`)) return
    startTransition(async () => {
      const res = await removeLeagueSeasonMember(currentLS!.id, userId)
      if (res?.error) { notify(res.error, true); return }
      setMembers((prev) => prev.filter((m) => m.userId !== userId))
      notify(`${displayName} removed.`)
    })
  }

  function handleAdd() {
    startTransition(async () => {
      let userId = selectedUserId

      if (addMode === 'new') {
        const nameToAdd = newMemberName.trim()
        if (!nameToAdd) { notify('Enter a name', true); return }
        const res = await createUser(nameToAdd)
        if ('error' in res) { notify(res.error, true); return }
        userId = res.id
      }

      if (!userId) { notify('Select a member', true); return }

      const fd = new FormData()
      fd.set('leagueSeasonId', currentLS!.id)
      fd.set('userId', userId)
      fd.set('draftPosition', String(nextPosition))
      const res = await addLeagueSeasonMember(fd)
      if (res?.error) { notify(res.error, true); return }

      const name = addMode === 'new' ? newMemberName.trim() : users.find((u) => u.id === userId)?.displayName ?? userId
      setMembers((prev) => [...prev, { userId, displayName: name, draftPosition: nextPosition }])
      setNewMemberName('')
      setSelectedUserId('')
      notify(`${name} added.`)
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-100">
            {league.name} — {currentSeason?.year} Season Members
          </h2>
          <span className="text-xs text-gray-500">{members.length} member{members.length !== 1 ? 's' : ''}</span>
        </div>

        {(error || success) && (
          <p className={`text-sm font-medium rounded-lg px-3 py-2 border ${error ? 'text-red-400 bg-red-950 border-red-800' : 'text-green-400 bg-green-950 border-green-800'}`}>
            {error ?? success}
          </p>
        )}

        {/* Member list */}
        <div className="space-y-1">
          {members.length === 0 && <p className="text-sm text-gray-600 text-center py-4">No members yet — add one below.</p>}
          {members
            .sort((a, b) => a.draftPosition - b.draftPosition)
            .map((m) => (
              <div key={m.userId} className="flex items-center justify-between py-2 px-3 bg-gray-800 rounded-lg">
                <span className="text-sm text-gray-100">
                  <span className="text-gray-500 text-xs mr-2">#{m.draftPosition}</span>
                  {m.displayName}
                </span>
                <button
                  onClick={() => handleRemove(m.userId, m.displayName)}
                  disabled={isPending}
                  className="text-xs text-red-600 hover:text-red-400 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            ))}
        </div>

        {/* Add member */}
        <div className="border-t border-gray-800 pt-4 space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setAddMode('existing')}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${addMode === 'existing' ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400'}`}
            >
              Existing user
            </button>
            <button
              onClick={() => setAddMode('new')}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${addMode === 'new' ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400'}`}
            >
              New user
            </button>
          </div>

          <div className="flex gap-2">
            {addMode === 'existing' ? (
              <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className={`${inputCls} flex-1`}>
                <option value="">Select user…</option>
                {nonMembers.map((u) => (
                  <option key={u.id} value={u.id}>{u.displayName}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="Display name…"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                className={`${inputCls} flex-1`}
              />
            )}
            <button onClick={handleAdd} disabled={isPending} className={btnCls}>
              {isPending ? '…' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      {seasons.length > 1 && (
        <p className="text-xs text-gray-600 text-center">
          Seasons: {seasons.map((s) => s.year).join(', ')}
        </p>
      )}
    </div>
  )
}

// ─── Draft View ───────────────────────────────────────────────────────────────

function DraftView({
  leagueSeason,
  availableTournaments,
  currentSeason,
  cutPlayers,
  espnEventId,
  espnEventName,
}: {
  leagueSeason: LeagueSeasonRow
  availableTournaments: TournamentRow[]
  currentSeason: SeasonRow | null
  cutPlayers: CutPlayer[]
  espnEventId: string | null
  espnEventName: string | null
}) {
  // Auto-select the tournament matching the current ESPN event, falling back to first available
  const autoMatch = espnEventId
    ? availableTournaments.find((t) => t.espnEventId === espnEventId) ?? availableTournaments[0]
    : availableTournaments[0]
  const [selectedTournamentId, setSelectedTournamentId] = useState(autoMatch?.id ?? '')
  const [search, setSearch] = useState('')
  const [filterCutOnly, setFilterCutOnly] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState<CutPlayer | null>(null)
  const [memberPicks, setMemberPicks] = useState<Record<string, CutPlayer[]>>(
    Object.fromEntries(leagueSeason.members.map((m) => [m.userId, []]))
  )
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const [savedLTId, setSavedLTId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const allAssigned = new Set(
    Object.values(memberPicks).flatMap((players) => players.map((p) => p.espnPlayerId))
  )

  const availablePlayers = cutPlayers
    .filter((p) => !allAssigned.has(p.espnPlayerId))
    .filter((p) => !filterCutOnly || p.madeCut)
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))

  function assignPlayer(userId: string) {
    if (!selectedPlayer) return
    setMemberPicks((prev) => {
      const current = prev[userId] ?? []
      if (current.length >= 4) return prev
      if (current.find((p) => p.espnPlayerId === selectedPlayer.espnPlayerId)) return prev
      return { ...prev, [userId]: [...current, selectedPlayer] }
    })
    setSelectedPlayer(null)
  }

  function removePlayer(userId: string, espnPlayerId: string) {
    setMemberPicks((prev) => ({
      ...prev,
      [userId]: (prev[userId] ?? []).filter((p) => p.espnPlayerId !== espnPlayerId),
    }))
  }

  function handleSave() {
    if (!selectedTournamentId) { setSaveError('Select a tournament first'); return }
    const picks = leagueSeason.members.map((m) => ({
      userId: m.userId,
      players: memberPicks[m.userId] ?? [],
    }))
    if (picks.every((p) => p.players.length === 0)) { setSaveError('Assign at least one player'); return }
    setSaveError(null)
    setSavedOk(false)
    startTransition(async () => {
      const res = await saveDraft(leagueSeason.id, selectedTournamentId, picks)
      if ('error' in res) { setSaveError(res.error ?? null); return }
      setSavedOk(true)
      setSavedLTId(res.leagueTournamentId ?? null)
    })
  }

  if (availableTournaments.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <p className="text-gray-400">All tournaments have been drafted.</p>
        <p className="text-xs text-gray-600 mt-2">Add more tournaments in the Admin page, then come back.</p>
      </div>
    )
  }

  if (leagueSeason.members.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <p className="text-gray-400">Add members to this league season before drafting.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Tournament selector + save bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-wrap items-center gap-4">
        <div className="space-y-1 flex-1 min-w-48">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Tournament</label>
            {espnEventId && autoMatch?.espnEventId === espnEventId && (
              <span className="text-xs bg-green-900 text-green-400 px-2 py-0.5 rounded-full font-medium">● Live on ESPN</span>
            )}
            {espnEventId && !autoMatch && espnEventName && (
              <span className="text-xs bg-yellow-900 text-yellow-400 px-2 py-0.5 rounded-full font-medium">ESPN: {espnEventName} — not in DB</span>
            )}
          </div>
          <select
            value={selectedTournamentId}
            onChange={(e) => setSelectedTournamentId(e.target.value)}
            className={`${inputCls} w-full`}
          >
            {availableTournaments.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="ml-auto px-5 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white font-semibold text-sm rounded-lg transition-colors"
        >
          {isPending ? 'Saving…' : 'Save Draft'}
        </button>
      </div>

      {saveError && (
        <p className="text-red-400 text-sm font-medium bg-red-950 border border-red-800 rounded-lg px-3 py-2">✗ {saveError}</p>
      )}
      {savedOk && (
        <p className="text-green-400 text-sm font-medium bg-green-950 border border-green-800 rounded-lg px-3 py-2">
          ✓ Draft saved! League is now live.{' '}
          {savedLTId && <a href={`/dashboard/${savedLTId}`} className="underline">View leaderboard →</a>}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Player pool */}
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-bold text-gray-100">
              Players <span className="text-sm font-normal text-gray-500">({availablePlayers.length} available)</span>
            </h2>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={filterCutOnly} onChange={(e) => setFilterCutOnly(e.target.checked)} className="w-4 h-4 accent-green-500" />
              <span className="text-sm text-gray-300">Made cut only</span>
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
              <button onClick={() => setSelectedPlayer(null)} className="text-green-500 hover:text-green-300 text-xs">Deselect</button>
            </div>
          )}
          <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
            {availablePlayers.map((player) => {
              const isSelected = selectedPlayer?.espnPlayerId === player.espnPlayerId
              return (
                <button
                  key={player.espnPlayerId}
                  onClick={() => setSelectedPlayer(isSelected ? null : player)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    isSelected ? 'border-green-500 bg-green-900/40 text-green-200'
                    : player.madeCut ? 'border-gray-700 bg-gray-800 hover:border-gray-500 text-gray-100'
                    : 'border-gray-800 bg-gray-900 hover:border-gray-600 text-gray-400'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{player.name}</span>
                    {!player.madeCut && <span className="text-xs px-1.5 py-0.5 rounded bg-red-900 text-red-400 font-medium">CUT</span>}
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

        {/* Teams */}
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-100">Teams</h2>
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {leagueSeason.members
              .sort((a, b) => a.draftPosition - b.draftPosition)
              .map((member) => {
                const picks = memberPicks[member.userId] ?? []
                const isFull = picks.length >= 4
                const canReceive = !!selectedPlayer && !isFull
                return (
                  <div
                    key={member.userId}
                    onClick={() => canReceive && assignPlayer(member.userId)}
                    className={`rounded-xl border p-4 transition-colors ${
                      canReceive ? 'border-green-500 bg-green-950/30 cursor-pointer hover:bg-green-950/50' : 'border-gray-700 bg-gray-900'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-semibold text-gray-100">{member.displayName}</p>
                      <span className="text-xs text-gray-500">{picks.length}/4</span>
                    </div>
                    <div className="space-y-1.5">
                      {picks.map((player, i) => (
                        <div
                          key={player.espnPlayerId}
                          className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-sm text-gray-100">
                            <span className="text-gray-600 text-xs mr-2">R{i + 1}</span>
                            {player.name}
                          </span>
                          <button onClick={() => removePlayer(member.userId, player.espnPlayerId)} className="text-xs text-gray-600 hover:text-red-400 transition-colors">✕</button>
                        </div>
                      ))}
                      {Array.from({ length: 4 - picks.length }).map((_, i) => (
                        <div
                          key={`empty-${i}`}
                          className={`flex items-center px-3 py-2 rounded-lg border border-dashed text-xs ${
                            canReceive ? 'border-green-600 text-green-600' : 'border-gray-700 text-gray-700'
                          }`}
                        >
                          {canReceive ? `Click to assign ${selectedPlayer!.name}` : `Round ${picks.length + i + 1} — empty`}
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
  leagueTournaments,
  leagueSeasons,
  existingTeamsByLT,
  cutPlayers,
  tournaments,
}: {
  leagueTournaments: LeagueTournamentRow[]
  leagueSeasons: LeagueSeasonRow[]
  existingTeamsByLT: Record<string, ExistingTeamPicks[]>
  cutPlayers: CutPlayer[]
  tournaments: TournamentRow[]
}) {
  const [selectedLTId, setSelectedLTId] = useState(leagueTournaments[0]?.id ?? '')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [teamsByLT, setTeamsByLT] = useState(existingTeamsByLT)
  const [addingToUserId, setAddingToUserId] = useState<string | null>(null)
  const [addSearch, setAddSearch] = useState('')
  const [filterCutOnly, setFilterCutOnly] = useState(false)
  const [renamingUserId, setRenamingUserId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const selectedLT = leagueTournaments.find((lt) => lt.id === selectedLTId)
  const teams = teamsByLT[selectedLTId] ?? []

  function notify(msg: string, isError = false) {
    setError(isError ? msg : null)
    setSuccess(isError ? null : msg)
    setTimeout(() => { setError(null); setSuccess(null) }, 3000)
  }

  function handleRemovePick(userId: string, pickId: string, playerName: string) {
    if (!selectedLT) return
    startTransition(async () => {
      const res = await removePlayerPick(selectedLT.id, pickId)
      if (res?.error) { notify(res.error, true); return }
      setTeamsByLT((prev) => ({
        ...prev,
        [selectedLT.id]: (prev[selectedLT.id] ?? []).map((t) =>
          t.userId !== userId ? t : { ...t, picks: t.picks.filter((p) => p.pickId !== pickId) }
        ),
      }))
      notify(`Removed ${playerName}.`)
    })
  }

  function handleAddPlayer(userId: string, player: CutPlayer) {
    if (!selectedLT) return
    startTransition(async () => {
      const res = await addPlayerToTeam(selectedLT.id, selectedLT.tournamentId, userId, player)
      if ('error' in res) { notify(res.error ?? 'Unknown error', true); return }
      const team = teams.find((t) => t.userId === userId)
      const nextRound = (team?.picks.length ?? 0) + 1
      setTeamsByLT((prev) => ({
        ...prev,
        [selectedLT.id]: (prev[selectedLT.id] ?? []).map((t) =>
          t.userId !== userId ? t : {
            ...t,
            picks: [...t.picks, { pickId: `tmp-${Date.now()}`, playerId: player.espnPlayerId, espnPlayerId: player.espnPlayerId, playerName: player.name, round: nextRound }],
          }
        ),
      }))
      setAddingToUserId(null)
      setAddSearch('')
      notify(`Added ${player.name}.`)
    })
  }

  function handleRename(userId: string) {
    startTransition(async () => {
      const res = await renameTeam(userId, renameValue)
      if (res?.error) { notify(res.error, true); return }
      setTeamsByLT((prev) => ({
        ...prev,
        [selectedLTId]: (prev[selectedLTId] ?? []).map((t) =>
          t.userId !== userId ? t : { ...t, displayName: renameValue.trim() }
        ),
      }))
      setRenamingUserId(null)
      notify('Renamed.')
    })
  }

  function handleComplete() {
    if (!selectedLT) return
    if (!confirm('Mark this tournament as complete? Polling stops and the winner screen shows.')) return
    startTransition(async () => {
      const res = await completeLeagueTournament(selectedLT.id)
      if (res?.error) { notify(res.error, true); return }
      notify('Tournament marked complete.')
    })
  }

  if (leagueTournaments.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <p className="text-gray-400">No drafts yet — use New Draft to create one.</p>
      </div>
    )
  }

  const assignedEspnIds = new Set(teams.flatMap((t) => t.picks.map((p) => p.espnPlayerId).filter(Boolean) as string[]))
  const addCandidates = cutPlayers
    .filter((p) => !assignedEspnIds.has(p.espnPlayerId))
    .filter((p) => !filterCutOnly || p.madeCut)
    .filter((p) => addSearch === '' || p.name.toLowerCase().includes(addSearch.toLowerCase()))

  return (
    <div className="space-y-4">
      {/* LT selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-1">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Tournament</label>
        <select value={selectedLTId} onChange={(e) => { setSelectedLTId(e.target.value); setAddingToUserId(null) }} className={`${inputCls} w-full`}>
          {leagueTournaments.map((lt) => (
            <option key={lt.id} value={lt.id}>{lt.tournamentName} · {lt.status}</option>
          ))}
        </select>
      </div>

      {(error || success) && (
        <p className={`text-sm font-medium rounded-lg px-3 py-2 border ${error ? 'text-red-400 bg-red-950 border-red-800' : 'text-green-400 bg-green-950 border-green-800'}`}>
          {error ?? success}
        </p>
      )}

      {selectedLT?.status === 'live' && (
        <div className="flex justify-end">
          <button onClick={handleComplete} disabled={isPending} className="px-4 py-2 bg-yellow-800 hover:bg-yellow-700 disabled:opacity-50 text-yellow-100 text-sm font-medium rounded-lg transition-colors">
            End Tournament
          </button>
        </div>
      )}

      {teams.map((team) => {
        const isAddingHere = addingToUserId === team.userId
        const isRenamingHere = renamingUserId === team.userId
        return (
          <div key={team.userId} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              {isRenamingHere ? (
                <div className="flex gap-2 flex-1">
                  <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(team.userId); if (e.key === 'Escape') setRenamingUserId(null) }}
                    maxLength={40} className={`${inputCls} flex-1`} />
                  <button onClick={() => handleRename(team.userId)} disabled={isPending || !renameValue.trim()} className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-xs rounded-lg font-medium">Save</button>
                  <button onClick={() => setRenamingUserId(null)} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-100 truncate">{team.displayName}</h3>
                  <span className="text-xs text-gray-500 shrink-0">{team.picks.length}/4</span>
                  <button onClick={() => { setRenamingUserId(team.userId); setRenameValue(team.displayName) }} className="text-xs text-gray-500 hover:text-blue-400 transition-colors shrink-0">Rename</button>
                </div>
              )}
              <a href={`/dashboard/${selectedLTId}`} className="text-xs text-gray-600 hover:text-green-400 shrink-0 transition-colors">Leaderboard →</a>
            </div>

            <div className="space-y-1.5">
              {team.picks.length === 0 && <p className="text-xs text-gray-600 px-1">No players yet.</p>}
              {team.picks.map((pick) => (
                <div key={pick.pickId} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-100">
                    <span className="text-gray-600 text-xs mr-2">R{pick.round}</span>
                    {pick.playerName}
                  </span>
                  <button onClick={() => handleRemovePick(team.userId, pick.pickId, pick.playerName)} disabled={isPending} className="text-xs text-gray-600 hover:text-red-400 disabled:opacity-40 transition-colors">✕</button>
                </div>
              ))}
              {Array.from({ length: Math.max(0, 4 - team.picks.length) }).map((_, i) => (
                <div key={`empty-${i}`} className="flex items-center px-3 py-2 rounded-lg border border-dashed border-gray-700 text-xs text-gray-700">
                  Round {team.picks.length + i + 1} — empty
                </div>
              ))}
            </div>

            {team.picks.length < 4 && (
              <div>
                {!isAddingHere ? (
                  <button onClick={() => { setAddingToUserId(team.userId); setAddSearch('') }} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">+ Add player</button>
                ) : (
                  <div className="space-y-2 pt-1">
                    <div className="flex gap-2 items-center">
                      <input autoFocus type="text" placeholder="Search players…" value={addSearch} onChange={(e) => setAddSearch(e.target.value)} className={`${inputCls} flex-1`} />
                      <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
                        <input type="checkbox" checked={filterCutOnly} onChange={(e) => setFilterCutOnly(e.target.checked)} className="w-3.5 h-3.5 accent-green-500" />
                        <span className="text-xs text-gray-400">Cut only</span>
                      </label>
                      <button onClick={() => { setAddingToUserId(null); setAddSearch('') }} className="text-xs text-gray-500 hover:text-gray-300 shrink-0">Cancel</button>
                    </div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {addCandidates.length === 0 && <p className="text-xs text-gray-600 py-2 text-center">No available players</p>}
                      {addCandidates.map((p) => (
                        <button key={p.espnPlayerId} onClick={() => handleAddPlayer(team.userId, p)} disabled={isPending}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-gray-700 bg-gray-800 hover:border-blue-500 text-left text-sm text-gray-100 disabled:opacity-40 transition-colors">
                          <span className="flex items-center gap-2">
                            {p.name}
                            {!p.madeCut && <span className="text-xs px-1 py-0.5 rounded bg-red-900 text-red-400">CUT</span>}
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
