'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Transaction, CAT_COLORS, CAT_ICONS, fmtDate, fmtMonth } from '@/lib/utils'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface Props {
  initialTransactions: Transaction[]
  userEmail: string
}

interface Toast { icon: string; title: string; body: string; error?: boolean }

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getDebits(txns: Transaction[]) {
  return txns.filter(t => t.type === 'Debit' && t.status !== 'REVERSED')
}

function getCatTotals(debits: Transaction[]) {
  const ct: Record<string, number> = {}
  debits.forEach(t => { ct[t.category] = (ct[t.category] || 0) + t.amount })
  return ct
}

function getMerchantTotals(debits: Transaction[]) {
  const totals: Record<string, number> = {}
  const counts: Record<string, number> = {}
  debits.forEach(t => {
    totals[t.details] = (totals[t.details] || 0) + t.amount
    counts[t.details] = (counts[t.details] || 0) + 1
  })
  return { totals, counts }
}

function getMonthTotals(debits: Transaction[]) {
  const mt: Record<string, number> = {}
  debits.forEach(t => { const m = t.date.slice(0, 7); mt[m] = (mt[m] || 0) + t.amount })
  return mt
}

function getDateRange(txns: Transaction[]) {
  if (!txns.length) return { min: '—', max: '—', days: 0 }
  const dates = txns.map(t => t.date).sort()
  const min = dates[0], max = dates[dates.length - 1]
  const days = Math.round((new Date(max).getTime() - new Date(min).getTime()) / 86400000) + 1
  return { min, max, days }
}

const MONTH_COLORS = ['#7b8ff5', '#ff6b6b', '#f5c842', '#34d399', '#a78bfa', '#fb923c', '#60a5fa', '#f472b6']

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DashboardClient({ initialTransactions, userEmail }: Props) {
  const [txns, setTxns] = useState<Transaction[]>(initialTransactions)
  const [activePage, setActivePage] = useState<'overview' | 'categories' | 'transactions' | 'advisor'>('overview')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [toast, setToast] = useState<Toast | null>(null)
  const [txnFilter, setTxnFilter] = useState('all')
  const [txnSearch, setTxnSearch] = useState('')
  const [txnPage, setTxnPage] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const PER_PAGE = 20

  // Theme init from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('fintrack_theme') as 'dark' | 'light' | null
    if (saved) setTheme(saved)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light')
    localStorage.setItem('fintrack_theme', theme)
  }, [theme])

  // Drag & drop
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => { e.preventDefault(); setIsDragging(true) }
    const onDragLeave = (e: DragEvent) => { if (!e.relatedTarget) setIsDragging(false) }
    const onDragOver = (e: DragEvent) => e.preventDefault()
    const onDrop = (e: DragEvent) => {
      e.preventDefault(); setIsDragging(false)
      const file = e.dataTransfer?.files[0]
      if (file) handleUpload(file)
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [])

  function showToast(icon: string, title: string, body: string, error = false) {
    setToast({ icon, title, body, error })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  async function handleUpload(file: File) {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      showToast('❌', 'Wrong file type', 'Please upload a Mashreq .xlsx statement', true)
      return
    }
    setUploading(true)
    showToast('⏳', 'Processing...', `Reading ${file.name}`)
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    const json = await res.json()
    setUploading(false)
    if (!res.ok) {
      showToast('❌', 'Upload failed', json.error || 'Unknown error', true)
      return
    }
    showToast('✅', `${json.added} new transactions added`, `${json.dupes} duplicates skipped · ${txns.length + json.added} total`)
    // Refresh transactions from server
    const { data } = await supabase.from('transactions').select('*').order('date', { ascending: false })
    if (data) setTxns(data)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ─── DERIVED DATA ──────────────────────────────────────────────────────────
  const debits = getDebits(txns)
  const catTotals = getCatTotals(debits)
  const catSorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1])
  const totalSpend = debits.reduce((s, t) => s + t.amount, 0)
  const totalReceived = txns.filter(t => t.type === 'Credit').reduce((s, t) => s + t.amount, 0)
  const net = totalReceived - totalSpend
  const { totals: merchantTotals, counts: merchantCounts } = getMerchantTotals(debits)
  const topMerchants = Object.entries(merchantTotals).sort((a, b) => b[1] - a[1]).slice(0, 12)
  const monthTotals = getMonthTotals(debits)
  const months = Object.keys(monthTotals).sort()
  const maxMonthSpend = Math.max(...Object.values(monthTotals), 1)
  const { min: dateMin, max: dateMax, days } = getDateRange(txns)

  // Category monthly breakdown
  const catMonthly: Record<string, Record<string, number>> = {}
  debits.forEach(t => {
    if (!catMonthly[t.category]) catMonthly[t.category] = {}
    const m = t.date.slice(0, 7)
    catMonthly[t.category][m] = (catMonthly[t.category][m] || 0) + t.amount
  })

  // Transactions filtering
  const filteredTxns = txns.filter(t => {
    const matchFilter = txnFilter === 'all' ? true : txnFilter === 'Debit' || txnFilter === 'Credit' ? t.type === txnFilter : t.category === txnFilter
    const matchSearch = !txnSearch || t.details.toLowerCase().includes(txnSearch.toLowerCase())
    return matchFilter && matchSearch
  })
  const totalPages = Math.ceil(filteredTxns.length / PER_PAGE)
  const pagedTxns = filteredTxns.slice((txnPage - 1) * PER_PAGE, txnPage * PER_PAGE)

  // ─── DONUT SVG ────────────────────────────────────────────────────────────
  function DonutChart() {
    const size = 140, cx = 70, cy = 70, r = 54, inner = 34
    let cum = 0
    const paths = catSorted.map(([cat, val]) => {
      const pct = val / totalSpend
      const a1 = cum * 2 * Math.PI - Math.PI / 2
      const a2 = (cum + pct) * 2 * Math.PI - Math.PI / 2
      cum += pct
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2)
      const xi1 = cx + inner * Math.cos(a1), yi1 = cy + inner * Math.sin(a1)
      const xi2 = cx + inner * Math.cos(a2), yi2 = cy + inner * Math.sin(a2)
      const lg = pct > 0.5 ? 1 : 0
      return <path key={cat} d={`M${x1},${y1} A${r},${r} 0 ${lg},1 ${x2},${y2} L${xi2},${yi2} A${inner},${inner} 0 ${lg},0 ${xi1},${yi1} Z`} fill={CAT_COLORS[cat]} opacity={0.9} />
    })
    return (
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        {paths}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="var(--text)" fontFamily="Syne,sans-serif" fontSize={13} fontWeight={800}>AED</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--text)" fontFamily="Syne,sans-serif" fontSize={11} fontWeight={700}>{Math.round(totalSpend / 1000)}K</text>
      </svg>
    )
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────
  const s = styles
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'DM Mono', monospace" }}>

      {/* Drag overlay */}
      {isDragging && (
        <div style={s.dropOverlay}>
          <div style={s.dropBox}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 22, color: 'var(--accent)' }}>Drop your Mashreq statement</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>.xlsx file · new transactions will be merged automatically</div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ ...s.toast, borderColor: toast.error ? 'rgba(255,107,107,0.3)' : 'var(--border)' }}>
          <span style={{ fontSize: 18 }}>{toast.icon}</span>
          <div>
            <div style={{ fontSize: 12, fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>{toast.title}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{toast.body}</div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }} />

      {/* Header */}
      <div style={s.header}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, letterSpacing: -0.5 }}>
          ADLY / <span style={{ color: 'var(--accent)' }}>FINTRACK</span>
        </div>
        <div style={s.tabs}>
          {(['overview', 'categories', 'transactions', 'advisor'] as const).map(page => (
            <button key={page} style={{ ...s.tab, ...(activePage === page ? s.tabActive : {}) }}
              onClick={() => setActivePage(page)}>
              {page.charAt(0).toUpperCase() + page.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.05em' }}>
            {dateMin !== '—' ? `${fmtDate(dateMin)} – ${fmtDate(dateMax)}` : 'No data yet'}
            <span style={s.dataBadge}><span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', marginRight: 4 }} />{txns.length} txns</span>
          </span>
          <span style={{ fontSize: 13 }}>{theme === 'dark' ? '🌙' : '☀️'}</span>
          <button style={s.themeToggle} onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
            <span style={{ ...s.themeKnob, transform: theme === 'light' ? 'translateX(16px)' : 'translateX(0)', background: theme === 'light' ? 'var(--accent3)' : 'var(--muted)' }} />
          </button>
          <button style={s.uploadBtn} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <svg width={12} height={12} viewBox="0 0 12 12" fill="none"><path d="M6 1v7M3 4l3-3 3 3M1 9v1.5A.5.5 0 001.5 11h9a.5.5 0 00.5-.5V9" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" /></svg>
            {uploading ? 'Uploading...' : 'Upload Statement'}
          </button>
          <button style={s.signOutBtn} onClick={handleSignOut}>Sign out</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px' }}>

        {/* ── OVERVIEW ── */}
        {activePage === 'overview' && (
          <div>
            <SectionLabel>Financial Snapshot</SectionLabel>

            {/* KPIs */}
            <div style={s.grid4}>
              <KPICard label="Total Spent" value={`AED ${Math.round(totalSpend).toLocaleString()}`} sub={`${debits.length} debit transactions`} color="var(--accent2)" glow="red" />
              <KPICard label="Total Received" value={`AED ${Math.round(totalReceived).toLocaleString()}`} sub="Credit payments & returns" color="var(--accent)" glow="green" />
              <KPICard label="Net Cash Flow" value={`${net >= 0 ? '+' : ''}AED ${Math.round(Math.abs(net)).toLocaleString()}`} sub={`${days}-day period`} color={net >= 0 ? 'var(--accent)' : 'var(--accent2)'} glow={net >= 0 ? 'green' : 'red'} />
              <KPICard label="Avg Daily Spend" value={`AED ${days > 0 ? Math.round(totalSpend / days).toLocaleString() : 0}`} sub={`AED ${days > 0 ? Math.round(totalSpend / days * 30).toLocaleString() : 0}/mo equivalent`} color="var(--accent3)" />
            </div>

            {/* Monthly cards */}
            <div style={{ ...s.gridAuto, marginBottom: 20 }}>
              {months.map((m, i) => {
                const val = monthTotals[m]
                const mTxns = debits.filter(t => t.date.startsWith(m))
                const daysActive = new Set(mTxns.map(t => t.date)).size
                const topM = Object.entries(mTxns.reduce((acc, t) => { acc[t.details] = (acc[t.details] || 0) + t.amount; return acc }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1])[0]
                const color = MONTH_COLORS[i % MONTH_COLORS.length]
                return (
                  <div key={m} style={s.card}>
                    <div style={s.cardLabel}>{fmtMonth(m)}</div>
                    <div style={{ ...s.cardValue, fontSize: 22, color }}>{`AED ${Math.round(val).toLocaleString()}`}</div>
                    <div style={s.cardSub}>{daysActive} active days · {mTxns.length} transactions</div>
                    <div style={s.summaryGrid}>
                      <SummaryCell val={String(mTxns.length)} label="Txns" color={color} />
                      <SummaryCell val={`AED ${daysActive > 0 ? Math.round(val / daysActive) : 0}`} label="Avg/day" color="var(--accent3)" />
                      <SummaryCell val={topM ? topM[0].slice(0, 10) : '—'} label="Top" color="var(--accent4)" small />
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={s.grid2}>
              {/* Donut */}
              <div style={s.card}>
                <div style={s.cardLabel}>Spending by Category</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  {totalSpend > 0 ? <DonutChart /> : <div style={{ color: 'var(--muted)', fontSize: 12 }}>No data yet</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                    {catSorted.map(([cat, val]) => (
                      <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLORS[cat], flexShrink: 0 }} />
                        <div style={{ fontSize: 11, flex: 1 }}>{cat}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{val.toFixed(0)}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', width: 36, textAlign: 'right' }}>{(val / totalSpend * 100).toFixed(0)}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Top merchants */}
              <div style={s.card}>
                <div style={s.cardLabel}>Top Merchants by Spend</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {topMerchants.map(([name, amt], i) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 10, border: '1px solid transparent' }}>
                      <div style={{ fontSize: 9, color: 'var(--muted)', width: 16, textAlign: 'center' }}>{i + 1}</div>
                      <div style={{ flex: 1, fontSize: 12 }}>{name.length > 22 ? name.slice(0, 22) + '…' : name}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', width: 50, textAlign: 'right' }}>{merchantCounts[name]}x</div>
                      <div style={{ fontSize: 12, color: 'var(--accent2)', fontFamily: 'Syne, sans-serif', fontWeight: 700, width: 80, textAlign: 'right' }}>AED {amt.toFixed(0)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Monthly bars */}
            <div style={{ ...s.card, marginBottom: 0 }}>
              <div style={s.cardLabel}>Monthly Spend Breakdown</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 140, paddingTop: 8 }}>
                {months.map((m, i) => {
                  const v = monthTotals[m]
                  const h = Math.round((v / maxMonthSpend) * 120)
                  const c = MONTH_COLORS[i % MONTH_COLORS.length]
                  return (
                    <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%' }}>
                      <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                        <div title={`AED ${v.toFixed(0)}`} style={{ width: '100%', height: h, background: `${c}22`, border: `1px solid ${c}44`, borderBottom: `2px solid ${c}`, borderRadius: '6px 6px 0 0', minHeight: 2 }} />
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.1em' }}>{fmtMonth(m).slice(0, 3).toUpperCase()}</div>
                      <div style={{ fontSize: 10, color: c }}>AED {Math.round(v / 1000)}K</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── CATEGORIES ── */}
        {activePage === 'categories' && (
          <div>
            <SectionLabel>Category Deep Dive</SectionLabel>
            <div style={s.gridAuto}>
              {catSorted.map(([cat, total]) => {
                const pct = (total / totalSpend * 100).toFixed(1)
                const vals = months.map(m => catMonthly[cat]?.[m] || 0)
                const lastTwo = vals.slice(-2)
                const trend = lastTwo.length > 1 ? (lastTwo[1] > lastTwo[0] ? '↑' : '↓') : ''
                const trendColor = trend === '↑' ? 'var(--accent2)' : 'var(--accent)'
                return (
                  <div key={cat} style={{ ...s.card, borderTop: `2px solid ${CAT_COLORS[cat]}33` }}>
                    <div style={s.cardLabel}>{CAT_ICONS[cat]} {cat.toUpperCase()}</div>
                    <div style={{ ...s.cardValue, fontSize: 22, color: CAT_COLORS[cat] }}>AED {total.toFixed(0)}</div>
                    <div style={s.cardSub}>{pct}% of total spend</div>
                    <div style={{ marginTop: 10, display: 'flex', gap: 6, fontSize: 10, color: 'var(--muted)', flexWrap: 'wrap' as const }}>
                      {months.map(m => <span key={m}>{fmtMonth(m).slice(0, 3)}: {(catMonthly[cat]?.[m] || 0).toFixed(0)}</span>)}
                      {trend && <span style={{ marginLeft: 'auto', color: trendColor }}>{trend}</span>}
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={s.grid2}>
              <div style={s.card}>
                <div style={s.cardLabel}>Category Spend — Full Breakdown</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {catSorted.map(([cat, val]) => (
                    <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', width: 140, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{cat}</div>
                      <div style={{ flex: 1, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${val / catSorted[0][1] * 100}%`, background: CAT_COLORS[cat], borderRadius: 4 }} />
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', width: 70, textAlign: 'right' as const }}>AED {val.toFixed(0)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={s.card}>
                <div style={s.cardLabel}>Category vs Monthly Trend</div>
                {catSorted.slice(0, 6).map(([cat]) => {
                  const vals = months.map(m => catMonthly[cat]?.[m] || 0)
                  const mx = Math.max(...vals, 1)
                  return (
                    <div key={cat} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: CAT_COLORS[cat], marginBottom: 5 }}>{CAT_ICONS[cat]} {cat}</div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 40 }}>
                        {months.map((m, i) => {
                          const v = catMonthly[cat]?.[m] || 0
                          const c = MONTH_COLORS[i % MONTH_COLORS.length]
                          return (
                            <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%' }}>
                              <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                                <div style={{ width: '100%', height: Math.round(v / mx * 36), background: `${c}33`, borderTop: `1px solid ${c}`, borderRadius: '2px 2px 0 0' }} />
                              </div>
                              <div style={{ fontSize: 8, color: 'var(--muted)' }}>{fmtMonth(m).slice(0, 1)}</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── TRANSACTIONS ── */}
        {activePage === 'transactions' && (
          <div>
            <SectionLabel>Transaction Log</SectionLabel>
            <div style={s.card}>
              {/* Filters */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const, alignItems: 'center' }}>
                {['all', 'Debit', 'Credit', 'Food & Dining', 'Transport', 'Shopping', 'Groceries', 'Entertainment', 'Tech & Subscriptions'].map(f => (
                  <button key={f} style={{ ...s.filterBtn, ...(txnFilter === f ? s.filterBtnActive : {}) }}
                    onClick={() => { setTxnFilter(f); setTxnPage(1) }}>
                    {f === 'all' ? 'All' : f === 'Tech & Subscriptions' ? 'Tech' : f}
                  </button>
                ))}
                <input style={s.searchInput} placeholder="Search merchant..." value={txnSearch}
                  onChange={e => { setTxnSearch(e.target.value); setTxnPage(1) }} />
              </div>

              {/* Table */}
              <div style={{ maxHeight: 480, overflowY: 'auto' as const }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
                  <thead>
                    <tr>
                      {['Date', 'Merchant', 'Category', 'Status', 'Amount (AED)'].map(h => (
                        <th key={h} style={{ ...s.th, textAlign: h === 'Amount (AED)' ? 'right' as const : 'left' as const }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTxns.map((t, i) => (
                      <tr key={t.id || i}>
                        <td style={{ ...s.td, color: 'var(--muted)' }}>{t.date}</td>
                        <td style={s.td}>{t.details.length > 28 ? t.details.slice(0, 28) + '…' : t.details}</td>
                        <td style={s.td}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12, fontSize: 9, background: `${CAT_COLORS[t.category]}12`, color: CAT_COLORS[t.category] }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: CAT_COLORS[t.category] }} />
                            {t.category}
                          </span>
                        </td>
                        <td style={s.td}>
                          <span style={{ fontSize: 9, letterSpacing: '0.1em', padding: '2px 7px', borderRadius: 10, textTransform: 'uppercase' as const, ...statusStyle(t.status) }}>
                            {t.status}
                          </span>
                        </td>
                        <td style={{ ...s.td, textAlign: 'right' as const, color: t.type === 'Debit' ? 'var(--accent2)' : 'var(--accent)', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>
                          {t.type === 'Debit' ? '-' : '+'}{t.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                  Showing {(txnPage - 1) * PER_PAGE + 1}–{Math.min(txnPage * PER_PAGE, filteredTxns.length)} of {filteredTxns.length}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {Array.from({ length: totalPages }, (_, i) => (
                    <button key={i} style={{ ...s.pageBtn, ...(i + 1 === txnPage ? s.pageBtnActive : {}) }} onClick={() => setTxnPage(i + 1)}>
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ADVISOR ── */}
        {activePage === 'advisor' && (
          <div>
            <SectionLabel>AI Financial Advisor — Based on Your Data</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {getInsights(catTotals, merchantTotals, merchantCounts, monthTotals, months, totalSpend, totalReceived, days).map((ins, i) => (
                <div key={i} style={{ ...s.insightCard, borderLeftColor: ins.color }}>
                  <div style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>{ins.icon}</div>
                  <div>
                    <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 700, marginBottom: 5 }}>{ins.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>{ins.body}</div>
                    <span style={{ display: 'inline-block', marginTop: 8, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, padding: '3px 10px', borderRadius: 10, border: `1px solid ${ins.pillColor}22`, background: `${ins.pillColor}08`, color: ins.pillColor }}>
                      {ins.pill}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase' as const, color: 'var(--muted)', marginBottom: 16, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 10 }}>
      {children}
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

function KPICard({ label, value, sub, color, glow }: { label: string; value: string; sub: string; color: string; glow?: string }) {
  return (
    <div style={{ ...styles.card, ...(glow ? { '--glow-color': glow === 'green' ? 'var(--accent)' : 'var(--accent2)' } as React.CSSProperties : {}) }}>
      {glow && <div style={{ position: 'absolute', top: -1, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${glow === 'green' ? 'var(--accent)' : 'var(--accent2)'}, transparent)` }} />}
      <div style={styles.cardLabel}>{label}</div>
      <div style={{ ...styles.cardValue, color }}>{value}</div>
      <div style={styles.cardSub}>{sub}</div>
    </div>
  )
}

function SummaryCell({ val, label, color, small }: { val: string; label: string; color: string; small?: boolean }) {
  return (
    <div style={{ textAlign: 'center' as const, padding: 16, background: 'var(--surface2)', borderRadius: 12 }}>
      <div style={{ fontFamily: 'Syne, sans-serif', fontSize: small ? 11 : 15, fontWeight: 800, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{val}</div>
      <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.15em', textTransform: 'uppercase' as const, marginTop: 4 }}>{label}</div>
    </div>
  )
}

function statusStyle(status: string) {
  const map: Record<string, React.CSSProperties> = {
    SETTLED: { background: 'rgba(0,229,160,0.08)', color: 'var(--accent)' },
    AUTHORIZED: { background: 'rgba(245,200,66,0.08)', color: 'var(--accent3)' },
    IN_PROGRESS: { background: 'rgba(123,143,245,0.08)', color: 'var(--accent4)' },
    REVERSED: { background: 'rgba(107,107,133,0.08)', color: 'var(--muted)' },
    REFUNDED: { background: 'rgba(107,107,133,0.08)', color: 'var(--muted)' },
  }
  return map[status] || { color: 'var(--muted)' }
}

// ─── ADVISOR INSIGHTS ─────────────────────────────────────────────────────────
function getInsights(
  catTotals: Record<string, number>,
  merchantTotals: Record<string, number>,
  merchantCounts: Record<string, number>,
  monthTotals: Record<string, number>,
  months: string[],
  totalSpend: number,
  totalReceived: number,
  days: number
) {
  const foodTotal = catTotals['Food & Dining'] || 0
  const deliverooSpend = merchantTotals['Deliveroo'] || 0
  const subscTotal = catTotals['Tech & Subscriptions'] || 0
  const net = totalReceived - totalSpend
  const foodPct = totalSpend > 0 ? (foodTotal / totalSpend * 100).toFixed(0) : 0
  const monthVals = months.map(m => monthTotals[m])
  const maxMonthVal = Math.max(...monthVals, 0)
  const maxMonthName = months.length ? fmtMonth(months[monthVals.indexOf(maxMonthVal)]) : '—'

  return [
    {
      icon: '🍽️', color: '#ff6b6b',
      title: `Food & Dining is your #1 expense — AED ${foodTotal.toFixed(0)}`,
      body: `${foodPct}% of your total spend goes to food. Deliveroo alone accounts for AED ${deliverooSpend.toFixed(0)} across ${merchantCounts['Deliveroo'] || 0} orders. Cutting 3 orders/week could save ~AED 1,000/month.`,
      pill: '💡 Actionable', pillColor: '#f5c842'
    },
    {
      icon: '💻', color: '#60a5fa',
      title: `AED ${subscTotal.toFixed(0)} in tech subscriptions — audit needed`,
      body: `Apple services alone billed across multiple charges in different amounts. Check for duplicate family plan charges or unused apps. A full subscription audit could recover AED 300–500/month.`,
      pill: '⚠️ Audit Now', pillColor: '#ff6b6b'
    },
    {
      icon: '📈', color: '#ff6b6b',
      title: `${maxMonthName} was your highest spend month — AED ${maxMonthVal.toFixed(0)}`,
      body: `Your spending varies significantly month to month. Track monthly totals regularly to distinguish one-off spikes from structural overspending patterns.`,
      pill: '📊 Context', pillColor: '#7b8ff5'
    },
    {
      icon: '💊', color: '#f472b6',
      title: `Mayfair Clinic: AED ${(merchantTotals['MAYFAIR CLINIC'] || 0).toFixed(0)} — Mounjaro costs`,
      body: `Recurring charges of AED 1,499 suggest a monthly Mounjaro prescription. An intentional health investment. Verify whether your Four Seasons role includes healthcare benefits that could offset this.`,
      pill: '✅ Keep Going', pillColor: '#00e5a0'
    },
    {
      icon: '🏠', color: '#f5c842',
      title: `Net cash flow: ${net >= 0 ? '+' : ''}AED ${Math.abs(net).toFixed(0)}`,
      body: `Over ${days} days you received AED ${totalReceived.toFixed(0)} and spent AED ${totalSpend.toFixed(0)}. With a housing allowance covering rent, consistent savings of AED 5,000–8,000/month toward a 1.5M property target is realistic.`,
      pill: '🏡 On Track', pillColor: '#00e5a0'
    },
    {
      icon: '🛍️', color: '#fbbf24',
      title: `Shopping hit AED ${(catTotals['Shopping'] || 0).toFixed(0)} — mostly impulse channels`,
      body: `Temu, Namshi, Amazon.ae, and Adidas spread across the period. Consider a monthly shopping cap of AED 800 and a 24-hour rule before confirming online orders.`,
      pill: '💡 Set a Cap', pillColor: '#f5c842'
    },
    {
      icon: '💳', color: '#6b7280',
      title: `TABBY repayments: AED ${(merchantTotals['TABBY'] || 0).toFixed(0)} across multiple charges`,
      body: `Active BNPL installment plan. TABBY spending is invisible in real-time budgeting — ensure you're accounting for upcoming installments in your monthly outgoings.`,
      pill: '🔔 Track It', pillColor: '#6b7280'
    },
  ]
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  header: {
    position: 'sticky', top: 0, zIndex: 100,
    background: 'var(--header-bg)',
    backdropFilter: 'blur(20px)',
    borderBottom: '1px solid var(--border)',
    padding: '14px 32px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  tabs: {
    display: 'flex', gap: 4,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10, padding: 4,
  },
  tab: {
    padding: '7px 18px', borderRadius: 7, cursor: 'pointer',
    fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 500,
    color: 'var(--muted)', border: 'none', background: 'none',
    letterSpacing: '0.03em', transition: 'all 0.2s',
  },
  tabActive: {
    background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)',
  },
  uploadBtn: {
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
    background: 'rgba(0,229,160,0.08)', border: '1px solid rgba(0,229,160,0.25)',
    color: 'var(--accent)', fontFamily: "'DM Mono', monospace", fontSize: 11,
    fontWeight: 500, letterSpacing: '0.03em',
  },
  signOutBtn: {
    padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
    background: 'none', border: '1px solid var(--border)',
    color: 'var(--muted)', fontFamily: "'DM Mono', monospace", fontSize: 11,
  },
  themeToggle: {
    width: 36, height: 20, borderRadius: 10, border: '1px solid var(--border)',
    background: 'var(--surface2)', cursor: 'pointer', position: 'relative',
    flexShrink: 0, outline: 'none',
  },
  themeKnob: {
    position: 'absolute', top: 2, left: 2,
    width: 14, height: 14, borderRadius: '50%',
    transition: 'transform 0.3s, background 0.3s', display: 'block',
  },
  dataBadge: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontSize: 9, letterSpacing: '0.08em', padding: '3px 8px',
    borderRadius: 8, background: 'rgba(0,229,160,0.06)',
    border: '1px solid rgba(0,229,160,0.15)', color: 'var(--muted)',
    marginLeft: 6,
  },
  card: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 16, padding: 24, position: 'relative', overflow: 'hidden',
  },
  cardLabel: {
    fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase',
    color: 'var(--muted)', marginBottom: 10, fontWeight: 500,
  },
  cardValue: {
    fontFamily: 'Syne, sans-serif', fontSize: 28, fontWeight: 800,
    lineHeight: 1, letterSpacing: -1,
  },
  cardSub: { fontSize: 11, color: 'var(--muted)', marginTop: 6 },
  summaryGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 16,
  },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 20 },
  gridAuto: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, marginBottom: 20 },
  dropOverlay: {
    position: 'fixed', inset: 0, zIndex: 999,
    background: 'rgba(10,10,15,0.92)', backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16,
  },
  dropBox: {
    border: '2px dashed var(--accent)', borderRadius: 20,
    padding: '60px 80px', textAlign: 'center',
  },
  toast: {
    position: 'fixed', bottom: 32, right: 32, zIndex: 1000,
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '14px 18px',
    display: 'flex', alignItems: 'flex-start', gap: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)', maxWidth: 340,
  },
  filterBtn: {
    padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
    fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
    color: 'var(--muted)', border: '1px solid var(--border)', background: 'none',
    letterSpacing: '0.05em',
  },
  filterBtnActive: {
    color: 'var(--text)', borderColor: 'var(--accent)', background: 'rgba(0,229,160,0.05)',
  },
  searchInput: {
    background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '6px 12px', color: 'var(--text)', fontFamily: "'DM Mono', monospace", fontSize: 11,
    outline: 'none', width: 220, marginLeft: 'auto',
  },
  th: {
    fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase',
    color: 'var(--muted)', fontWeight: 500, padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
  },
  td: {
    padding: '10px 12px', borderBottom: '1px solid rgba(42,42,56,0.5)', fontSize: 11,
  },
  pageBtn: {
    padding: '5px 10px', background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: 6, cursor: 'pointer', color: 'var(--muted)', fontSize: 11,
    fontFamily: "'DM Mono', monospace",
  },
  pageBtnActive: { color: 'var(--text)', borderColor: 'var(--accent)', background: 'rgba(0,229,160,0.05)' },
  insightCard: {
    background: 'var(--surface2)', borderRadius: 12, padding: 18,
    borderLeft: '3px solid', display: 'flex', gap: 14, alignItems: 'flex-start',
  },
}
