import { NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const leagueId = req.nextUrl.searchParams.get('leagueId')
  if (!leagueId) return Response.json({ error: 'leagueId required' }, { status: 400 })

  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('team_scores')
    .select('user_id, total_strokes, rank')
    .eq('league_id', leagueId)
    .order('rank', { ascending: true })

  return Response.json(data ?? [])
}
