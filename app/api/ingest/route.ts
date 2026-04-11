import { NextRequest } from 'next/server'
import { runIngest } from '@/lib/ingest'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-ingest-secret')
  if (secret !== process.env.INGEST_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { tournamentId } = await req.json().catch(() => ({}))
  if (!tournamentId) {
    return Response.json({ error: 'tournamentId required' }, { status: 400 })
  }

  const result = await runIngest(tournamentId)
  return Response.json(result, { status: 'error' in result ? 502 : 200 })
}
