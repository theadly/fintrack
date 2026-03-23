import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('budget_targets')
    .select('category, monthly_target')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { category, monthly_target } = await request.json()
  if (!category || monthly_target === undefined) {
    return NextResponse.json({ error: 'category and monthly_target required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('budget_targets')
    .upsert({ user_id: user.id, category, monthly_target: parseFloat(monthly_target), updated_at: new Date().toISOString() }, { onConflict: 'user_id,category' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
