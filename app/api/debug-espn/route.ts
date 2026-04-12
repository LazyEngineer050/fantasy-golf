import { NextResponse } from 'next/server'
import { fetchEspnLeaderboard } from '@/lib/espn'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export async function GET() {
  // 1. What ESPN extraction produces
  const espnPlayers = await fetchEspnLeaderboard('401811941')
  const extracted = espnPlayers.slice(0, 5).map((p) => ({
    name: p.name,
    thru: p.thru,
    teeTime: p.teeTime,
    todayStrokes: p.todayStrokes,
    r4Strokes: p.r4Strokes,
  }))

  // 2. What's currently in the DB for those same players (by name)
  const supabase = createSupabaseServiceClient()
  const names = espnPlayers.slice(0, 5).map((p) => p.name)
  const { data: players } = await supabase
    .from('players')
    .select('id, name')
    .in('name', names)

  const playerIds = (players ?? []).map((p: { id: string }) => p.id)
  const { data: scores } = await supabase
    .from('player_scores')
    .select('player_id, thru, tee_time, today_strokes, r4_strokes')
    .in('player_id', playerIds)

  const dbRows = (players ?? []).map((p: { id: string; name: string }) => {
    const s = (scores ?? []).find((r: { player_id: string }) => r.player_id === p.id)
    return { name: p.name, ...s }
  })

  return NextResponse.json({ extracted, dbRows })
}
