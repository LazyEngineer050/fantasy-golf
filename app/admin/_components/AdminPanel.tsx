'use client'

import { useState, useTransition } from 'react'
import { createTournament, updateTournament, setLeagueTournamentStatus, updatePayoutConfig, triggerIngest } from '@/app/actions/admin'

interface Tournament {
  id: string
  name: string
  espn_event_id: string | null
  start_date: string
  end_date: string
}

interface LeagueTournamentRow {
  id: string
  status: 'drafting' | 'live' | 'completed'
  tournament_name: string
  league_name: string
  season_year: number | null
  buy_in: number
  best_player_prize: number
  best_team_prize: number
  side_bet: number
}

interface Props {
  tournaments: Tournament[]
  leagueTournaments: LeagueTournamentRow[]
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

function CreateTournamentForm() {
  const { isPending, error, run } = useAction()

  return (
    <Section title="New Tournament">
      <form action={(fd) => run(() => createTournament(fd))} className="space-y-3">
        <Field label="Name">
          <input name="name" required placeholder="PGA Championship 2026" className={inputCls} />
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
        <p className="text-xs text-gray-500">Season is assigned automatically based on the start year. Draft the event in the Commissioner page.</p>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button type="submit" disabled={isPending} className={btnCls}>
          {isPending ? 'Creating…' : 'Create Tournament'}
        </button>
      </form>
    </Section>
  )
}

function TournamentCard({ t }: { t: Tournament }) {
  const { isPending, error, run } = useAction()
  const [editing, setEditing] = useState(false)

  return (
    <div className="bg-gray-800 rounded-lg px-3 py-2 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-100">{t.name}</p>
          <p className="text-xs text-gray-500">{t.start_date} → {t.end_date}{t.espn_event_id ? ` · ESPN ${t.espn_event_id}` : ' · no ESPN ID'}</p>
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="px-2.5 py-1 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium transition-colors"
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>
      {editing && (
        <form
          action={(fd) => run(() => updateTournament(t.id, fd), () => setEditing(false))}
          className="space-y-3 border-t border-gray-700 pt-3"
        >
          <Field label="Name">
            <input name="name" required defaultValue={t.name} className={inputCls} />
          </Field>
          <Field label="ESPN Event ID">
            <input name="espnEventId" defaultValue={t.espn_event_id ?? ''} placeholder="401811952" className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start Date">
              <input name="startDate" type="date" required defaultValue={t.start_date} className={inputCls} />
            </Field>
            <Field label="End Date">
              <input name="endDate" type="date" required defaultValue={t.end_date} className={inputCls} />
            </Field>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={isPending} className={btnCls}>
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}
    </div>
  )
}

function LeagueTournamentCard({ lt }: { lt: LeagueTournamentRow }) {
  const statusAction = useAction()
  const payoutAction = useAction()
  const ingestAction = useAction()
  const [ingestMsg, setIngestMsg] = useState<string | null>(null)

  const statusBadge: Record<string, string> = {
    drafting: 'bg-yellow-900/50 text-yellow-300 border border-yellow-800',
    live: 'bg-green-900/50 text-green-300 border border-green-800',
    completed: 'bg-gray-800 text-gray-400 border border-gray-700',
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-gray-100">{lt.tournament_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{lt.league_name}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[lt.status]}`}>
          {lt.status}
        </span>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Status</p>
        <div className="flex gap-2">
          {(['drafting', 'live', 'completed'] as const).map((s) => (
            <button
              key={s}
              disabled={statusAction.isPending || lt.status === s}
              onClick={() => statusAction.run(() => setLeagueTournamentStatus(lt.id, s))}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors disabled:opacity-50 ${
                lt.status === s
                  ? 'bg-gray-700 text-gray-300 cursor-default ring-1 ring-gray-600'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        {statusAction.error && <p className="text-red-400 text-xs mt-1">{statusAction.error}</p>}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">ESPN Ingest</p>
        <button
          disabled={ingestAction.isPending}
          onClick={() => {
            setIngestMsg(null)
            ingestAction.run(
              () => triggerIngest(lt.id),
              () => setIngestMsg('Done')
            )
          }}
          className="px-3 py-1.5 text-xs rounded-lg font-medium transition-colors bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50"
        >
          {ingestAction.isPending ? 'Pulling from ESPN…' : '↓ Pull ESPN scores now'}
        </button>
        {ingestAction.error && <p className="text-red-400 text-xs mt-1">{ingestAction.error}</p>}
        {ingestMsg && <p className="text-green-400 text-xs mt-1">{ingestMsg}</p>}
      </div>

      <form
        action={(fd) => payoutAction.run(() => updatePayoutConfig(lt.id, fd))}
        className="space-y-3 border-t border-gray-800 pt-3"
      >
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Payout</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Buy-in ($)">
            <input name="buy_in" type="number" min="0" required defaultValue={lt.buy_in} className={inputCls} />
          </Field>
          <Field label="Best Team Prize ($)">
            <input name="best_team_prize" type="number" min="0" required defaultValue={lt.best_team_prize} className={inputCls} />
          </Field>
          <Field label="Best Player Prize ($)">
            <input name="best_player_prize" type="number" min="0" required defaultValue={lt.best_player_prize} className={inputCls} />
          </Field>
          <Field label="Side-bet ($)">
            <input name="side_bet" type="number" min="0" required defaultValue={lt.side_bet} className={inputCls} />
          </Field>
        </div>
        {payoutAction.error && <p className="text-red-400 text-xs">{payoutAction.error}</p>}
        <button type="submit" disabled={payoutAction.isPending} className={btnCls}>
          {payoutAction.isPending ? 'Saving…' : 'Save Payout'}
        </button>
      </form>
    </div>
  )
}

export default function AdminPanel({ tournaments, leagueTournaments }: Props) {
  return (
    <div className="space-y-6">
      <CreateTournamentForm />

      {tournaments.length > 0 && (
        <Section title="Tournaments">
          <div className="space-y-2">
            {tournaments.map((t) => (
              <TournamentCard key={t.id} t={t} />
            ))}
          </div>
        </Section>
      )}

      {leagueTournaments.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-100">League Tournaments</h2>
          <p className="text-xs text-gray-500">Manage status here. Use the Commissioner page to manage drafts and members.</p>
          {leagueTournaments.map((lt) => (
            <LeagueTournamentCard key={lt.id} lt={lt} />
          ))}
        </div>
      )}
    </div>
  )
}
