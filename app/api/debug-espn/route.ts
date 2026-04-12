import { NextResponse } from 'next/server'

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
}

export async function GET() {
  const res = await fetch(SCOREBOARD_URL, { headers: HEADERS, cache: 'no-store' })
  const data = await res.json()
  const competitors = data?.events?.[0]?.competitions?.[0]?.competitors ?? []

  // Return first 3 competitors with full raw data so we can see the structure
  return NextResponse.json(competitors.slice(0, 3))
}
