import { createSupabaseServerClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import Link from 'next/link'
import LoginForm from './_components/LoginForm'

export default async function HomePage() {
  const cookieStore = await cookies()
  const userId = cookieStore.get('user_id')?.value ?? null

  const supabase = await createSupabaseServerClient()

  const { data: leagues } = await supabase
    .from('leagues')
    .select('id, name, status, tournaments(name)')
    .order('status', { ascending: true })

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

        <div>
          <h2 className="text-lg font-bold mb-4 text-gray-200">Leagues</h2>
          {(!leagues || leagues.length === 0) && (
            <p className="text-gray-500 text-sm">
              No leagues yet. Ask your commissioner to set one up.
            </p>
          )}
          <div className="space-y-3">
            {(leagues ?? []).map((league: any) => (
              <div
                key={league.id}
                className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center justify-between"
              >
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
                  <span
                    className={`px-2 py-1 text-xs rounded-full font-medium ${
                      league.status === 'live'
                        ? 'bg-green-900 text-green-300'
                        : league.status === 'completed'
                        ? 'bg-gray-700 text-gray-400'
                        : 'bg-yellow-900 text-yellow-300'
                    }`}
                  >
                    {league.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
