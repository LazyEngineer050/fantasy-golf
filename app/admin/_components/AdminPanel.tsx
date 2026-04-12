'use client'

import { useState, useTransition } from 'react'
import {
  createTournament,
  createLeague,
  createSeries,
  assignLeagueToSeries,
  addLeagueMember,
  removeLeagueMember,
  initDraft,
  setLeagueStatus,
} from '@/app/actions/admin'

interface Tournament {
  id: string
  name: string
  espn_event_id: string | null
  start_date: string
  end_date: string
}

interface Series {
  id: string
  name: string
  year: number | null
}

interface LeagueWithMembers {
  id: string
  name: string
  status: 'drafting' | 'live' | 'completed'
  tournament_id: string
  tournament_name: string
  series_id: string | null
  members: Array<{ user_id: string; draft_position: number; display_name: string }>
}

interface User {
  id: string
  display_name: string
}

interface Props {
  tournaments: Tournament[]
  seriesList: Series[]
  leagues: LeagueWithMembers[]
  users: User[]
}

function useAction() {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(fn: () => Promise<{ error?: string; ok?: boolean }>, onSuccess?: () => void) {
    setError(null)
    startTransition(async () => {
      const result = await fn()
      if (result?.error) setError(result.error)
      else onSuccess?.()
    })
  }

  return { isPending, error, setError, run }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
      <h2 className="text-lg font-bold text-gray-100">{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-green-500'
const btnCls = 'px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors'

// ─── Create Series ────────────────────────────────────────────────────────────

function CreateSeriesForm() {
  const { isPending, error, run } = useAction()

  return (
    <Section title="New Series">
      <p className="text-xs text-gray-500">A series groups multiple leagues (same teams, different tournaments) into a season.</p>
      <form action={(fd) => run(() => createSeries(fd))} className="space-y-3">
        <Field label="Series Name">
          <input name="name" required placeholder="2026 Majors" className={inputCls} />
        </Field>
        <Field label="Year (optional)">
          <input name="year" type="number" placeholder="2026" className={inputCls} />
        </Field>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button type="submit" disabled={isPending} className={btnCls}>
          {isPending ? 'Creating…' : 'Create Series'}
        </button>
      </form>
    </Section>
  )
}

// ─── Create Tournament ────────────────────────────────────────────────────────

function CreateTournamentForm() {
  const { isPending, error, run } = useAction()

  return (
    <Section title="New Tournament">
      <form
        action={(fd) => run(() => createTournament(fd))}
        className="space-y-3"
      >
        <Field label="Name">
          <input name="name" required placeholder="The Masters 2025" className={inputCls} />
        </Field>
        <Field label="ESPN Event ID (optional)">
          <input name="espnEventId" placeholder="401580351" className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Date">
            <input name="startDate" type="date" required className={inputCls} />
          </Field>
          <Field label="End Date">
            <input name="endDate" type="date" required className={inputCls} />
          </Field>
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button type="submit" disabled={isPending} className={btnCls}>
          {isPending ? 'Creating…' : 'Create Tournament'}
        </button>
      </form>
    </Section>
  )
}

// ─── Create League ────────────────────────────────────────────────────────────

function CreateLeagueForm({ tournaments, seriesList }: { tournaments: Tournament[]; seriesList: Series[] }) {
  const { isPending, error, run } = useAction()

  return (
    <Section title="New League">
      <form action={(fd) => run(() => createLeague(fd))} className="space-y-3">
        <Field label="League Name">
          <input name="name" required placeholder="ButteryBiscuits" className={inputCls} />
        </Field>
        <Field label="Tournament">
          <select name="tournamentId" required className={inputCls}>
            <option value="">Select a tournament…</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>
        {seriesList.length > 0 && (
          <Field label="Series (optional)">
            <select name="seriesId" className={inputCls}>
              <option value="">No series (standalone)</option>
              {seriesList.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.year ? ` (${s.year})` : ''}</option>
              ))}
            </select>
          </Field>
        )}
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button type="submit" disabled={isPending} className={btnCls}>
          {isPending ? 'Creating…' : 'Create League'}
        </button>
      </form>
    </Section>
  )
}

// ─── League Card ─────────────────────────────────────────────────────────────

function LeagueCard({ league, users, seriesList }: { league: LeagueWithMembers; users: User[]; seriesList: Series[] }) {
  const [open, setOpen] = useState(false)
  const memberAction = useAction()
  const statusAction = useAction()
  const draftAction = useAction()
  const seriesAction = useAction()

  const memberUserIds = new Set(league.members.map((m) => m.user_id))
  const nonMembers = users.filter((u) => !memberUserIds.has(u.id))
  const nextPosition = league.members.length + 1

  const currentSeries = seriesList.find((s) => s.id === league.series_id)

  const statusColors: Record<string, string> = {
    drafting: 'bg-yellow-900 text-yellow-300',
    live: 'bg-green-900 text-green-300',
    completed: 'bg-gray-700 text-gray-400',
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800">
      <button
        className="w-full flex items-center justify-between p-4 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <p className="font-semibold text-gray-100">{league.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {league.tournament_name}
            {currentSeries && <span className="ml-2 text-blue-400">· {currentSeries.name}</span>}
            {' '}· {league.members.length} member{league.members.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[league.status]}`}>
            {league.status}
          </span>
          <span className="text-gray-600">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-800 p-4 space-y-5">

          {/* Series assignment */}
          {seriesList.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Series</p>
              <div className="flex gap-2">
                <select
                  className={`${inputCls} flex-1`}
                  defaultValue={league.series_id ?? ''}
                  onChange={(e) => seriesAction.run(() => assignLeagueToSeries(league.id, e.target.value || null))}
                >
                  <option value="">No series (standalone)</option>
                  {seriesList.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.year ? ` (${s.year})` : ''}</option>
                  ))}
                </select>
              </div>
              {seriesAction.error && <p className="text-red-400 text-xs">{seriesAction.error}</p>}
            </div>
          )}

          {/* Members list */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Members</p>
            {league.members.length === 0 && (
              <p className="text-sm text-gray-500">No members yet</p>
            )}
            <div className="space-y-1">
              {league.members.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between py-1.5 px-3 bg-gray-800 rounded-lg">
                  <span className="text-sm text-gray-100">
                    <span className="text-gray-500 text-xs mr-2">#{m.draft_position}</span>
                    {m.display_name}
                  </span>
                  <button
                    onClick={() => memberAction.run(() => removeLeagueMember(league.id, m.user_id))}
                    disabled={memberAction.isPending}
                    className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Add member */}
          {nonMembers.length > 0 && (
            <form action={(fd) => memberAction.run(() => addLeagueMember(fd))} className="space-y-2">
              <input type="hidden" name="leagueId" value={league.id} />
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Add Member</p>
              <div className="flex gap-2">
                <select name="userId" required className={`${inputCls} flex-1`}>
                  <option value="">Select user…</option>
                  {nonMembers.map((u) => (
                    <option key={u.id} value={u.id}>{u.display_name}</option>
                  ))}
                </select>
                <input
                  name="draftPosition"
                  type="number"
                  min={1}
                  defaultValue={nextPosition}
                  required
                  className={`${inputCls} w-20`}
                  placeholder="#"
                />
                <button type="submit" disabled={memberAction.isPending} className={btnCls}>
                  {memberAction.isPending ? '…' : 'Add'}
                </button>
              </div>
              {memberAction.error && <p className="text-red-400 text-xs">{memberAction.error}</p>}
            </form>
          )}

          {/* Status controls */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">League Status</p>
            <div className="flex gap-2 flex-wrap">
              {(['drafting', 'live', 'completed'] as const).map((s) => (
                <button
                  key={s}
                  disabled={statusAction.isPending || league.status === s}
                  onClick={() => statusAction.run(() => setLeagueStatus(league.id, s))}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors disabled:opacity-50 ${
                    league.status === s
                      ? 'bg-gray-700 text-gray-300 cursor-default'
                      : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {statusAction.error && <p className="text-red-400 text-xs">{statusAction.error}</p>}
          </div>

          {/* Start draft */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Draft</p>
            <button
              disabled={draftAction.isPending || league.members.length === 0}
              onClick={() => draftAction.run(() => initDraft(league.id))}
              className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
            >
              {draftAction.isPending ? 'Starting…' : 'Initialize / Reset Draft'}
            </button>
            <p className="text-xs text-gray-500">Sets pick 1 on clock for member in position #1. Resets if already started.</p>
            {draftAction.error && <p className="text-red-400 text-xs">{draftAction.error}</p>}
          </div>

        </div>
      )}
    </div>
  )
}

// ─── Root Panel ───────────────────────────────────────────────────────────────

export default function AdminPanel({ tournaments, seriesList, leagues, users }: Props) {
  return (
    <div className="space-y-6">
      <CreateSeriesForm />
      <CreateTournamentForm />
      <CreateLeagueForm tournaments={tournaments} seriesList={seriesList} />

      {leagues.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-100">Leagues</h2>
          {leagues.map((l) => (
            <LeagueCard key={l.id} league={l} users={users} seriesList={seriesList} />
          ))}
        </div>
      )}

      {leagues.length === 0 && (
        <p className="text-center text-gray-600 text-sm py-4">No leagues yet — create one above.</p>
      )}
    </div>
  )
}
