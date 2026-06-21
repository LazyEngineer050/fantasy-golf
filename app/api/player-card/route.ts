import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { HoleScore } from '@/lib/espn'

interface RoundStats {
  score: number | null
  holes: HoleScore[]
  eagles: number
  birdies: number
  pars: number
  bogeys: number
  doubles: number
  worse: number
}

function summariseRound(holes: HoleScore[], score: number | null): RoundStats {
  const stats: RoundStats = { score, holes, eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, worse: 0 }
  for (const h of holes) {
    if (h.r <= -2) stats.eagles++
    else if (h.r === -1) stats.birdies++
    else if (h.r === 0) stats.pars++
    else if (h.r === 1) stats.bogeys++
    else if (h.r === 2) stats.doubles++
    else stats.worse++
  }
  return stats
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const playerId = searchParams.get('playerId')
  const tournamentId = searchParams.get('tournamentId')
  if (!playerId || !tournamentId) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('player_scores')
    .select('total_strokes, today_strokes, thru, position, tee_time, r1_strokes, r2_strokes, r3_strokes, r4_strokes, hole_scores')
    .eq('player_id', playerId)
    .eq('tournament_id', tournamentId)
    .maybeSingle()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const hs = (data.hole_scores ?? {}) as { r1?: HoleScore[]; r2?: HoleScore[]; r3?: HoleScore[]; r4?: HoleScore[] }

  const rounds = [
    { label: 'R1', holes: hs.r1 ?? [], score: data.r1_strokes as number | null },
    { label: 'R2', holes: hs.r2 ?? [], score: data.r2_strokes as number | null },
    { label: 'R3', holes: hs.r3 ?? [], score: data.r3_strokes as number | null },
    { label: 'R4', holes: hs.r4 ?? [], score: data.r4_strokes as number | null },
  ]
    .filter((r) => r.score !== null || r.holes.length > 0)
    .map((r) => ({ label: r.label, ...summariseRound(r.holes, r.score) }))

  return NextResponse.json({
    total_strokes: data.total_strokes,
    today_strokes: data.today_strokes,
    thru: data.thru,
    position: data.position,
    tee_time: data.tee_time,
    rounds,
  })
}
