import { createSupabaseServerClient } from '@/lib/supabase/server'
import AdminPanel from './_components/AdminPanel'

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient()

  const { data: tournamentsRaw } = await supabase
    .from('tournaments')
    .select('id, name, espn_event_id, start_date, end_date')
    .order('start_date', { ascending: false })

  const { data: leaguesRaw } = await supabase
    .from('leagues')
    .select('id, name, status, tournament_id, tournaments(name)')
    .order('name', { ascending: true })

  const { data: usersRaw } = await supabase
    .from('users')
    .select('id, display_name')
    .order('display_name', { ascending: true })

  const { data: membersRaw } = await supabase
    .from('league_members')
    .select('league_id, user_id, draft_position, users(display_name)')
    .order('draft_position', { ascending: true })

  type Tournament = { id: string; name: string; espn_event_id: string | null; start_date: string; end_date: string }
  type League = { id: string; name: string; status: 'drafting' | 'live' | 'completed'; tournament_id: string; tournaments: { name: string } | null }
  type User = { id: string; display_name: string }
  type Member = { league_id: string; user_id: string; draft_position: number; users: { display_name: string } | null }

  const tournaments = (tournamentsRaw ?? []) as unknown as Tournament[]
  const leagues = (leaguesRaw ?? []) as unknown as League[]
  const users = (usersRaw ?? []) as unknown as User[]
  const members = (membersRaw ?? []) as unknown as Member[]

  const membersByLeague = new Map<string, Array<{ user_id: string; draft_position: number; display_name: string }>>()
  for (const m of members) {
    if (!membersByLeague.has(m.league_id)) membersByLeague.set(m.league_id, [])
    membersByLeague.get(m.league_id)!.push({
      user_id: m.user_id,
      draft_position: m.draft_position,
      display_name: m.users?.display_name ?? 'Unknown',
    })
  }

  const leaguesWithMembers = leagues.map((l) => ({
    ...l,
    tournament_name: l.tournaments?.name ?? 'Unknown',
    members: membersByLeague.get(l.id) ?? [],
  }))

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-5">
        <h1 className="text-2xl font-bold text-green-400">⛳ ButteryBiscuits — Admin</h1>
        <p className="text-gray-400 text-sm mt-1">Manage tournaments, leagues, and members</p>
      </div>
      <div className="max-w-3xl mx-auto p-6">
        <AdminPanel
          tournaments={tournaments}
          leagues={leaguesWithMembers}
          users={users}
        />
      </div>
    </div>
  )
}
