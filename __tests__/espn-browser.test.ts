import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchEspnLeaderboardFromBrowser, fetchScoreboardPayload } from '@/lib/espn-browser'
import { SCOREBOARD_URL } from '@/lib/espn'

const payload = {
  events: [{
    id: '401811964',
    name: 'TOUR Championship',
    competitions: [{
      date: '2026-08-27T04:00Z',
      competitors: [
        {
          id: '5076021', order: 1, score: '-10', athlete: { displayName: 'Ryan Gerard' },
          linescores: [
            { period: 1, value: 65, displayValue: '-5' },
            { period: 2, value: 65, displayValue: '-5' },
            { period: 3 },   // not started — no value key
          ],
        },
      ],
    }],
  }],
}

afterEach(() => { vi.unstubAllGlobals() })

function stubFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

describe('fetchScoreboardPayload', () => {
  it('requests the scoreboard without custom headers (avoids a CORS preflight)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchScoreboardPayload()
    expect(fetchMock).toHaveBeenCalledWith(SCOREBOARD_URL, { cache: 'no-store' })
  })

  it('returns null on a non-ok response', async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }))
    expect(await fetchScoreboardPayload()).toBeNull()
  })

  it('returns null when the request throws', async () => {
    stubFetch(async () => { throw new Error('network') })
    expect(await fetchScoreboardPayload()).toBeNull()
  })
})

describe('fetchEspnLeaderboardFromBrowser', () => {
  it('returns the parsed leaderboard and the raw payload for hand-off to ingest', async () => {
    stubFetch(async () => ({ ok: true, json: async () => payload }))
    const result = await fetchEspnLeaderboardFromBrowser()
    expect(result?.leaderboard.eventId).toBe('401811964')
    expect(result?.leaderboard.players).toHaveLength(1)
    expect(result?.leaderboard.players[0].name).toBe('Ryan Gerard')
    expect(result?.leaderboard.players[0].totalStrokes).toBe(-10)
    // The raw payload is passed through untouched so the server can re-parse it.
    expect(result?.payload).toBe(payload)
  })

  it('returns null when ESPN is unreachable', async () => {
    stubFetch(async () => { throw new Error('network') })
    expect(await fetchEspnLeaderboardFromBrowser()).toBeNull()
  })
})
