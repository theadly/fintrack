import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { categorize } from '@/lib/utils'
import * as XLSX from 'xlsx'

// Increase body size limit to 10MB for xlsx uploads
export const maxDuration = 30
export const dynamic = 'force-dynamic'

// Next.js body size config
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let formData: FormData
    try {
      formData = await request.formData()
    } catch (e: any) {
      return NextResponse.json({ error: `Failed to parse form data: ${e.message}` }, { status: 400 })
    }

    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (file.size === 0) return NextResponse.json({ error: 'File is empty' }, { status: 400 })

    let buffer: ArrayBuffer
    try {
      buffer = await file.arrayBuffer()
    } catch (e: any) {
      return NextResponse.json({ error: `Failed to read file: ${e.message}` }, { status: 400 })
    }

    let wb: XLSX.WorkBook
    try {
      wb = XLSX.read(buffer, { type: 'array' })
    } catch (e: any) {
      return NextResponse.json({ error: `Failed to parse Excel file: ${e.message}` }, { status: 400 })
    }

    if (!wb.SheetNames.length) {
      return NextResponse.json({ error: 'Excel file has no sheets' }, { status: 400 })
    }

    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as string[][]

    if (!rows.length) {
      return NextResponse.json({ error: 'Sheet is empty' }, { status: 400 })
    }

    // Find header row — look for row containing both 'Date' and 'Details'
    let headerRow = -1
    for (let i = 0; i < Math.min(15, rows.length); i++) {
      const r = rows[i].map(c => String(c).trim())
      if (r.some(c => c === 'Date') && r.some(c => c === 'Details')) {
        headerRow = i
        break
      }
    }

    if (headerRow === -1) {
      // Debug: return what we found in first few rows
      const preview = rows.slice(0, 6).map(r => r.map(c => String(c).trim()).join(' | '))
      return NextResponse.json({
        error: 'Unrecognised format — could not find Date/Details header row',
        debug_preview: preview
      }, { status: 400 })
    }

    const headers = rows[headerRow].map(c => String(c).trim())
    const iDate = headers.findIndex(h => h === 'Date')
    const iDetails = headers.findIndex(h => h === 'Details')
    const iAmount = headers.findIndex(h => h.toLowerCase().startsWith('amount'))
    const iType = headers.findIndex(h => h === 'Debit/Credit')
    const iStatus = headers.findIndex(h => h === 'Status')

    if (iDate === -1 || iDetails === -1 || iAmount === -1 || iType === -1) {
      return NextResponse.json({
        error: 'Missing required columns',
        found_headers: headers,
        expected: ['Date', 'Details', 'Amount', 'Debit/Credit', 'Status']
      }, { status: 400 })
    }

    const parsed: Array<{user_id: string; date: string; details: string; amount: number; type: string; status: string; category: string}> = []
    let skippedRows = 0

    for (let i = headerRow + 1; i < rows.length; i++) {
      const r = rows[i]
      const rawDate = String(r[iDate] || '').trim()
      const details = String(r[iDetails] || '').trim()
      const rawAmt = parseFloat(String(r[iAmount] || '0').replace(/,/g, ''))
      const type = String(r[iType] || '').trim()
      const status = String(r[iStatus] !== undefined ? r[iStatus] : '').trim().toUpperCase() || 'SETTLED'

      if (!rawDate || !details || !type || isNaN(rawAmt) || rawAmt === 0) {
        skippedRows++
        continue
      }

      let date = ''
      // "22 Mar 2026" format (DD Mon YYYY)
      const dm = rawDate.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
      // "Nov 30, 2025" format (Mon DD, YYYY)
      const dm2 = rawDate.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/)
      if (dm) {
        const months: Record<string, string> = {
          jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
          jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12'
        }
        const m = months[dm[2].toLowerCase().slice(0, 3)]
        if (!m) { skippedRows++; continue }
        date = `${dm[3]}-${m}-${dm[1].padStart(2, '0')}`
      } else if (dm2) {
        const months: Record<string, string> = {
          jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
          jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12'
        }
        const m = months[dm2[1].toLowerCase().slice(0, 3)]
        if (!m) { skippedRows++; continue }
        date = `${dm2[3]}-${m}-${dm2[2].padStart(2, '0')}`
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        date = rawDate
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawDate)) {
        // DD/MM/YYYY or MM/DD/YYYY
        const parts = rawDate.split('/')
        date = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`
      } else if (typeof r[iDate] === 'number') {
        // Excel serial date
        const d = XLSX.SSF.parse_date_code(r[iDate] as unknown as number)
        if (d) {
          date = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`
        } else { skippedRows++; continue }
      } else {
        skippedRows++
        continue
      }

      const category = type === 'Credit' ? 'Income' : categorize(details)
      parsed.push({ user_id: user.id, date, details, amount: rawAmt, type, status, category })
    }

    if (!parsed.length) {
      return NextResponse.json({
        error: 'No valid transactions found',
        total_rows: rows.length - headerRow - 1,
        skipped_rows: skippedRows,
        header_row_index: headerRow,
        headers
      }, { status: 400 })
    }

    // Dedup against existing
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
      // Insert in batches of 200 to avoid payload limits
      const batchSize = 200
      for (let i = 0; i < newTxns.length; i += batchSize) {
        const batch = newTxns.slice(i, i + batchSize)
        const { error } = await supabase.from('transactions').insert(batch)
        if (error) return NextResponse.json({ error: `Insert failed: ${error.message}` }, { status: 500 })
      }
    }

    await supabase.from('uploaded_files').insert({
      user_id: user.id,
      filename: file.name,
      rows_added: newTxns.length,
      rows_skipped: dupeCount,
    })

    return NextResponse.json({ added: newTxns.length, dupes: dupeCount, total: parsed.length })

  } catch (e: any) {
    return NextResponse.json({ error: `Unexpected error: ${e.message}` }, { status: 500 })
  }
}
