import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  // Verify user exists
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('users').select('id').eq('id', userId).maybeSingle()
  if (!data) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const res = NextResponse.json({ ok: true })
  res.cookies.set('user_id', userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  return res
}
