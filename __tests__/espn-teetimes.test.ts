import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchTeeTimes, formatTeeTimeET, parseTeeTimePayload, teeTimeUrl } from '@/lib/espn-teetimes'
import { playedRoundsFor } from '@/lib/leaderboard'

// Shape returned by ESPN's core API for one competitor, R3 played and R4 pending.
const payload = {
  count: 4,
  items: [
    { period: 1, value: 64, displayValue: '-6', teeTime: '2026-08-27T15:12Z', groupNumber: 3, startTee: 1 },
    { period: 2, value: 66, displayValue: '-4', teeTime: '2026-08-28T17:36Z', groupNumber: 9, startTee: 1 },
    { period: 3, value: 65, displayValue: '-5', teeTime: '2026-08-29T18:07Z', groupNumber: 14, startTee: 1 },
    { period: 4, courseId: 57, hasStream: false, startTee: 1, groupNumber: 15, teeTime: '2026-08-30T17:50Z' },
  ],
}

afterEach(() => { vi.unstubAllGlobals() })

describe('teeTimeUrl', () => {
  it('addresses the competitor\'s linescores on the core API', () => {
    expect(teeTimeUrl('401811964', '4364873')).toBe(
      'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811964' +
      '/competitions/401811964/competitors/4364873/linescores?limit=10'
    )
  })
})

describe('parseTeeTimePayload', () => {
  it('pulls the requested round, including pairing details', () => {
    expect(parseTeeTimePayload(payload, 4)).toEqual({
      period: 4, teeTime: '2026-08-30T17:50Z', groupNumber: 15, startTee: 1,
    })
  })

  it('reads an earlier round too', () => {
    expect(parseTeeTimePayload(payload, 1)?.teeTime).toBe('2026-08-27T15:12Z')
  })

  it('returns null for a round with no entry', () => {
    expect(parseTeeTimePayload({ items: [{ period: 1, teeTime: 'x' }] }, 4)).toBeNull()
  })

  it('returns null when the entry carries no tee time', () => {
    expect(parseTeeTimePayload({ items: [{ period: 4 }] }, 4)).toBeNull()
  })

  it('returns null for junk', () => {
    expect(parseTeeTimePayload(null, 4)).toBeNull()
    expect(parseTeeTimePayload({}, 4)).toBeNull()
    expect(parseTeeTimePayload({ items: 'nope' }, 4)).toBeNull()
  })
})

describe('formatTeeTimeET', () => {
  it('converts UTC to Eastern during daylight time', () => {
    expect(formatTeeTimeET('2026-08-30T17:50Z')).toBe('1:50 PM ET')
  })

  it('converts UTC to Eastern during standard time', () => {
    // Same UTC clock time in November is an hour earlier in ET — the IANA zone
    // handles the DST shift that a fixed -4 offset would get wrong.
    expect(formatTeeTimeET('2026-11-15T17:50Z')).toBe('12:50 PM ET')
  })

  it('handles morning times', () => {
    expect(formatTeeTimeET('2026-08-30T15:26Z')).toBe('11:26 AM ET')
  })

  it('returns null for an unparseable timestamp', () => {
    expect(formatTeeTimeET('not a date')).toBeNull()
  })
})

describe('fetchTeeTimes', () => {
  it('maps player ids to formatted tee times', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })))
    const times = await fetchTeeTimes('401811964', ['4364873', '5076021'], 4)
    expect(times.get('4364873')).toBe('1:50 PM ET')
    expect(times.get('5076021')).toBe('1:50 PM ET')
  })

  it('omits players whose request fails, without throwing', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      if (call === 1) throw new Error('network')
      return { ok: true, json: async () => payload }
    }))
    const times = await fetchTeeTimes('401811964', ['bad', 'good'], 4)
    expect(times.has('bad')).toBe(false)
    expect(times.get('good')).toBe('1:50 PM ET')
  })

  it('returns an empty map when the round has no tee times', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ period: 4 }] }) })))
    expect((await fetchTeeTimes('401811964', ['1'], 4)).size).toBe(0)
  })
})

describe('playedRoundsFor', () => {
  it('lists rounds with data, highest first', () => {
    expect(playedRoundsFor([
      { r1_strokes: -5, r2_strokes: -5, r3_strokes: -4, r4_strokes: null },
      { r1_strokes: 2, r2_strokes: null, r3_strokes: null, r4_strokes: null },
    ])).toEqual([3, 2, 1])
  })

  it('counts a level-par round as played', () => {
    expect(playedRoundsFor([{ r1_strokes: 0, r2_strokes: null }])).toEqual([1])
  })

  it('is empty before anyone posts a score', () => {
    expect(playedRoundsFor([{ r1_strokes: null }])).toEqual([])
    expect(playedRoundsFor([])).toEqual([])
  })
})
