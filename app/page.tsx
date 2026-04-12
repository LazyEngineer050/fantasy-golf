import { createSupabaseServerClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import Link from 'next/link'
import LoginForm from './_components/LoginForm'

export default async function HomePage() {
  const cookieStore = await cookies()
  const userId = cookieStore.get('user_id')?.value ?? null

  const supabase = await createSupabaseServerClient()

  const [leaguesResult, seriesResult] = await Promise.all([
    supabase
      .from('leagues')
      .select('id, name, status, tournament_id, series_id, tournaments(name)')
      .order('status', { ascending: true }),
    supabase
      .from('series')
      .select('id, name, year')
      .order('year', { ascending: false }),
  ])

  type League = { id: string; name: string; status: 'drafting' | 'live' | 'completed'; tournament_id: string; series_id: string | null; tournaments: { name: string } | null }
  type Series = { id: string; name: string; year: number | null }

  const leagues = (leaguesResult.data ?? []) as unknown as League[]
  const seriesList = (seriesResult.data ?? []) as unknown as Series[]

  // Partition leagues: series-grouped vs standalone
  const standaloneLeagues = leagues.filter((l) => !l.series_id)
  const seriesMap = new Map<string, League[]>()
  for (const l of leagues) {
    if (l.series_id) {
      if (!seriesMap.has(l.series_id)) seriesMap.set(l.series_id, [])
      seriesMap.get(l.series_id)!.push(l)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-green-400">⛳ ButteryBiscuits</h1>
          <p className="text-gray-400 text-sm mt-1">Post-cut snake draft · Live scoring</p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link href="/commissioner" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors">Commissioner</Link>
          <Link href="/admin" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors">Admin</Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-8">
        {!userId && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
            <h2 className="text-lg font-bold mb-4">Join a League</h2>
            <LoginForm />
          </div>
        )}

        {/* Series groups */}
        {seriesList.filter((s) => seriesMap.has(s.id)).map((series) => {
          const seriesLeagues = seriesMap.get(series.id) ?? []
          return (
            <div key={series.id}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-gray-200">
                  {series.name}{series.year ? ` · ${series.year}` : ''}
                </h2>
                <Link
                  href={`/series/${series.id}`}
                  className="text-xs px-3 py-1.5 bg-yellow-900/50 hover:bg-yellow-900 text-yellow-400 rounded-lg transition-colors font-medium"
                >
                  Season Standings →
                </Link>
              </div>
              <div className="space-y-3">
                {seriesLeagues.map((league) => (
                  <LeagueRow key={league.id} league={league} />
                ))}
              </div>
            </div>
          )
        })}

        {/* Standalone leagues */}
        {standaloneLeagues.length > 0 && (
          <div>
            <h2 className="text-lg font-bold mb-3 text-gray-200">Leagues</h2>
            <div className="space-y-3">
              {standaloneLeagues.map((league) => (
                <LeagueRow key={league.id} league={league} />
              ))}
            </div>
          </div>
        )}

        {leagues.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-8">
            No leagues yet. Ask your commissioner to set one up.
          </p>
        )}
      </main>
    </div>
  )
}

function LeagueRow({ league }: { league: { id: string; name: string; status: string; tournaments: { name: string } | null } }) {
  const statusColors: Record<string, string> = {
    live: 'bg-green-900 text-green-300',
    completed: 'bg-gray-700 text-gray-400',
    drafting: 'bg-yellow-900 text-yellow-300',
  }
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center justify-between">
      <div>
        <p className="font-semibold text-gray-100">{league.name}</p>
        <p className="text-sm text-gray-500">{league.tournaments?.name}</p>
      </div>
      <div className="flex items-center gap-2">
        {league.status === 'drafting' && (
          <Link
            href={`/draft/${league.id}`}
            className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-sm rounded-lg font-medium transition-colors"
          >
            Draft Room
          </Link>
        )}
        {(league.status === 'live' || league.status === 'completed') && (
          <Link
            href={`/dashboard/${league.id}`}
            className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded-lg font-medium transition-colors"
          >
            Leaderboard
          </Link>
        )}
        <span className={`px-2 py-1 text-xs rounded-full font-medium ${statusColors[league.status] ?? 'bg-gray-700 text-gray-400'}`}>
          {league.status}
        </span>
      </div>
    </div>
  )
}
