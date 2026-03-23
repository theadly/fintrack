import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { categorize } from '@/lib/utils'

// POST — add a transaction manually
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { date, details, amount, type, status, category, notes } = body

  if (!date || !details || !amount || !type) {
    return NextResponse.json({ error: 'Missing required fields: date, details, amount, type' }, { status: 400 })
  }

  const cat = category || (type === 'Credit' ? 'Income' : categorize(details))
  const { data, error } = await supabase
    .from('transactions')
    .insert({ user_id: user.id, date, details, amount: parseFloat(amount), type, status: status || 'SETTLED', category: cat, notes: notes || '' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE — bulk delete
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids } = await request.json()
  if (!Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('transactions')
    .delete()
    .in('id', ids)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: ids.length })
}

// PATCH — bulk update (e.g. bulk recategorise)
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids, update } = await request.json()
  if (!Array.isArray(ids) || !ids.length || !update) {
    return NextResponse.json({ error: 'ids array and update object required' }, { status: 400 })
  }

  const allowed = ['category', 'status', 'notes']
  const safe: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in update) safe[key] = update[key]
  }

  const { error } = await supabase
    .from('transactions')
    .update(safe)
    .in('id', ids)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ updated: ids.length })
}
