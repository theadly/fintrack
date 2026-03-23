import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { categorize } from '@/lib/utils'
import * as XLSX from 'xlsx'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as string[][]

  let headerRow = -1
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = rows[i].map(c => String(c).trim())
    if (r.includes('Date') && r.includes('Details')) { headerRow = i; break }
  }
  if (headerRow === -1) return NextResponse.json({ error: 'Unrecognised format' }, { status: 400 })

  const headers = rows[headerRow].map(c => String(c).trim())
  const iDate = headers.indexOf('Date')
  const iDetails = headers.findIndex(h => h === 'Details')
  const iAmount = headers.findIndex(h => h.startsWith('Amount'))
  const iType = headers.findIndex(h => h === 'Debit/Credit')
  const iStatus = headers.indexOf('Status')

  const parsed = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i]
    const rawDate = String(r[iDate] || '').trim()
    const details = String(r[iDetails] || '').trim()
    const rawAmt = parseFloat(String(r[iAmount] || '0').replace(/,/g, ''))
    const type = String(r[iType] || '').trim()
    const status = String(r[iStatus] || '').trim().toUpperCase()

    if (!rawDate || !details || !type || isNaN(rawAmt)) continue

    let date = ''
    const dm = rawDate.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
    if (dm) {
      const months: Record<string, string> = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' }
      const m = months[dm[2].toLowerCase().slice(0, 3)]
      if (!m) continue
      date = `${dm[3]}-${m}-${dm[1].padStart(2, '0')}`
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      date = rawDate
    } else continue

    const category = type === 'Credit' ? 'Income' : categorize(details)
    parsed.push({ user_id: user.id, date, details, amount: rawAmt, type, status, category })
  }

  if (!parsed.length) return NextResponse.json({ error: 'No valid transactions found' }, { status: 400 })

  const { data: existing } = await supabase
    .from('transactions')
    .select('date, details, amount, type')
    .eq('user_id', user.id)

  const existingKeys = new Set(
    (existing || []).map((t: { date: string; details: string; amount: number; type: string }) =>
      `${t.date}|${t.details}|${t.amount}|${t.type}`
    )
  )

  const newTxns = parsed.filter(t => !existingKeys.has(`${t.date}|${t.details}|${t.amount}|${t.type}`))
  const dupeCount = parsed.length - newTxns.length

  if (newTxns.length > 0) {
    const { error } = await supabase.from('transactions').insert(newTxns)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabase.from('uploaded_files').insert({
    user_id: user.id,
    filename: file.name,
    rows_added: newTxns.length,
    rows_skipped: dupeCount,
  })

  return NextResponse.json({ added: newTxns.length, dupes: dupeCount, total: parsed.length })
}
