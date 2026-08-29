'use client'

/**
 * Browser-side ESPN access.
 *
 * Vercel's servers cannot currently reach site.api.espn.com (every server-side
 * fetch fails), but ESPN serves the scoreboard with `Access-Control-Allow-Origin: *`,
 * so the user's browser can fetch it directly. The raw payload is parsed with the
 * same pure helpers the server uses, and can be handed back to the server for
 * ingestion (see `POST /api/refresh`).
 */

import { SCOREBOARD_URL, espnLeaderboardFromPayload, type EspnLeaderboard } from '@/lib/espn'

/** Fetch the raw ESPN scoreboard payload from the browser. Returns null on any failure. */
export async function fetchScoreboardPayload(): Promise<unknown | null> {
  try {
    // No custom headers — they would trigger a CORS preflight ESPN does not answer.
    const res = await fetch(SCOREBOARD_URL, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Fetch + parse the scoreboard in the browser. Returns the payload too, for re-use by ingest. */
export async function fetchEspnLeaderboardFromBrowser(): Promise<
  { payload: unknown; leaderboard: EspnLeaderboard } | null
> {
  const payload = await fetchScoreboardPayload()
  if (payload == null) return null
  const leaderboard = espnLeaderboardFromPayload(payload)
  if (!leaderboard) return null
  return { payload, leaderboard }
}
