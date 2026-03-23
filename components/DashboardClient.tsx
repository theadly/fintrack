'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Transaction, CAT_COLORS, CAT_ICONS, CATEGORIES, fmtDate, fmtMonth } from '@/lib/utils'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'
import { DirhamSymbol } from '@/components/DirhamSymbol'

interface Props {
  initialTransactions: Transaction[]
  initialBudgets: Record<string, number>
  userEmail: string
}

interface Toast { icon: string; title: string; body: string; error?: boolean }

// ── Dirham helpers ──────────────────────────────────────────────────────────
function D({ amount, decimals = 0, suffix = '' }: { amount: number; decimals?: number; suffix?: string }) {
  const num = decimals > 0 ? amount.toFixed(decimals) : Math.round(amount).toLocaleString()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.18em' }}>
      <DirhamSymbol />
      <span>{num}{suffix}</span>
    </span>
  )
}
function dStr(amount: number) { return `\u20C3 ${Math.round(amount).toLocaleString()}` }

// ── Data helpers ─────────────────────────────────────────────────────────────
function getDebits(txns: Transaction[]) { return txns.filter(t => t.type === 'Debit' && t.status !== 'REVERSED') }
function getCatTotals(debits: Transaction[]) {
  const ct: Record<string, number> = {}
  debits.forEach(t => { ct[t.category] = (ct[t.category] || 0) + t.amount })
  return ct
}
function getMerchantTotals(debits: Transaction[]) {
  const totals: Record<string, number> = {}; const counts: Record<string, number> = {}
  debits.forEach(t => { totals[t.details] = (totals[t.details] || 0) + t.amount; counts[t.details] = (counts[t.details] || 0) + 1 })
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
const MONTH_COLORS = ['#7b8ff5','#ff6b6b','#f5c842','#34d399','#a78bfa','#fb923c','#60a5fa','#f472b6']

// ── Modal ────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 480, padding: 28, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'var(--muted)', display: 'block', marginBottom: 5, fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, type = 'text', placeholder = '' }: { value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }} />
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, appearance: 'none' as const }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Btn({ onClick, children, color, disabled, small }: { onClick: () => void; children: React.ReactNode; color?: string; disabled?: boolean; small?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: small ? '5px 12px' : '8px 18px', borderRadius: 8, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', background: color || 'var(--accent)', color: color ? '#fff' : '#000', fontSize: small ? 11 : 13, fontFamily: 'inherit', fontWeight: 600, opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function DashboardClient({ initialTransactions, initialBudgets, userEmail }: Props) {
  const [txns, setTxns] = useState<Transaction[]>(initialTransactions)
  const [budgets, setBudgets] = useState<Record<string, number>>(initialBudgets)
  const [activePage, setActivePage] = useState<'overview' | 'categories' | 'transactions' | 'subscriptions' | 'advisor'>('overview')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [toast, setToast] = useState<Toast | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Global filters (affect all tabs)
  const [globalSearch, setGlobalSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [catFilter, setCatFilter] = useState('All')

  // Transactions tab state
  const [txnPage, setTxnPage] = useState(1)
  const [sortCol, setSortCol] = useState<'date' | 'details' | 'category' | 'amount' | 'status'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<Transaction>>({})
  const [showAddModal, setShowAddModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [newTxn, setNewTxn] = useState({ date: '', details: '', amount: '', type: 'Debit', category: 'Food & Dining', status: 'SETTLED', notes: '' })
  const [bulkAction, setBulkAction] = useState<'recategorise' | 'delete'>('recategorise')
  const [bulkCategory, setBulkCategory] = useState('Food & Dining')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()
  const supabase = createClient()
  const PER_PAGE = 25

  // Theme
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
    const onDrop = (e: DragEvent) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer?.files[0]; if (f) handleUpload(f) }
    document.addEventListener('dragenter', onDragEnter); document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('dragover', onDragOver); document.addEventListener('drop', onDrop)
    return () => { document.removeEventListener('dragenter', onDragEnter); document.removeEventListener('dragleave', onDragLeave); document.removeEventListener('dragover', onDragOver); document.removeEventListener('drop', onDrop) }
  }, [])

  function showToast(icon: string, title: string, body: string, error = false) {
    setToast({ icon, title, body, error })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  async function handleUpload(file: File) {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) { showToast('❌', 'Wrong file type', 'Please upload a Mashreq .xlsx statement', true); return }
    setUploading(true); showToast('⏳', 'Processing...', `Reading ${file.name}`)
    const formData = new FormData(); formData.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    const json = await res.json()
    setUploading(false)
    if (!res.ok) { showToast('❌', 'Upload failed', json.error || 'Unknown error', true); return }
    showToast('✅', `${json.added} transactions added`, `${json.dupes} duplicates skipped`)
    router.refresh()
  }

  async function handleSignOut() {
    await fetch('/api/signout', { method: 'POST' }); router.push('/login')
  }

  // ── Filtered transactions (used by all views) ──────────────────────────────
  const filteredTxns = useMemo(() => {
    let t = txns
    if (globalSearch) {
      const q = globalSearch.toLowerCase()
      t = t.filter(x => x.details.toLowerCase().includes(q) || x.category.toLowerCase().includes(q) || (x.notes || '').toLowerCase().includes(q))
    }
    if (dateFrom) t = t.filter(x => x.date >= dateFrom)
    if (dateTo) t = t.filter(x => x.date <= dateTo)
    if (catFilter !== 'All') t = t.filter(x => x.category === catFilter)
    return t
  }, [txns, globalSearch, dateFrom, dateTo, catFilter])

  // ── Sorted transactions for table ──────────────────────────────────────────
  const sortedTxns = useMemo(() => {
    const t = [...filteredTxns]
    t.sort((a, b) => {
      let av: string | number = a[sortCol] ?? ''
      let bv: string | number = b[sortCol] ?? ''
      if (sortCol === 'amount') { av = a.amount; bv = b.amount }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return t
  }, [filteredTxns, sortCol, sortDir])

  const totalPages = Math.max(1, Math.ceil(sortedTxns.length / PER_PAGE))
  const pageTxns = sortedTxns.slice((txnPage - 1) * PER_PAGE, txnPage * PER_PAGE)

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
    setTxnPage(1)
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function saveEdit(id: string) {
    const res = await fetch(`/api/transactions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editDraft) })
    const json = await res.json()
    if (!res.ok) { showToast('❌', 'Save failed', json.error, true); return }
    setTxns(prev => prev.map(t => t.id === id ? { ...t, ...json } : t))
    setEditingId(null); setEditDraft({})
    showToast('✅', 'Saved', `Updated ${json.details}`)
  }

  async function deleteTxn(id: string) {
    const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' })
    if (!res.ok) { showToast('❌', 'Delete failed', 'Try again', true); return }
    setTxns(prev => prev.filter(t => t.id !== id))
    showToast('🗑️', 'Deleted', '1 transaction removed')
  }

  async function addTxn() {
    const res = await fetch('/api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newTxn, amount: parseFloat(newTxn.amount) }) })
    const json = await res.json()
    if (!res.ok) { showToast('❌', 'Failed', json.error, true); return }
    setTxns(prev => [json, ...prev])
    setShowAddModal(false)
    setNewTxn({ date: '', details: '', amount: '', type: 'Debit', category: 'Food & Dining', status: 'SETTLED', notes: '' })
    showToast('✅', 'Added', json.details)
  }

  async function bulkDelete() {
    const ids = [...selected]
    const res = await fetch('/api/transactions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
    if (!res.ok) { showToast('❌', 'Bulk delete failed', 'Try again', true); return }
    setTxns(prev => prev.filter(t => !selected.has(t.id)))
    setSelected(new Set()); setShowBulkModal(false)
    showToast('🗑️', 'Deleted', `${ids.length} transactions removed`)
  }

  async function bulkRecategorise() {
    const ids = [...selected]
    const res = await fetch('/api/transactions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, update: { category: bulkCategory } }) })
    if (!res.ok) { showToast('❌', 'Failed', 'Try again', true); return }
    setTxns(prev => prev.map(t => selected.has(t.id) ? { ...t, category: bulkCategory } : t))
    setSelected(new Set()); setShowBulkModal(false)
    showToast('✅', 'Recategorised', `${ids.length} transactions → ${bulkCategory}`)
  }

  async function saveBudget(category: string, value: number) {
    const res = await fetch('/api/budgets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, monthly_target: value }) })
    if (!res.ok) { showToast('❌', 'Budget save failed', 'Try again', true); return }
    setBudgets(prev => ({ ...prev, [category]: value }))
    showToast('✅', 'Budget set', `${category}: ${dStr(value)}/mo`)
  }

  function exportCSV() {
    const headers = ['Date', 'Merchant', 'Category', 'Type', 'Amount', 'Status', 'Notes']
    const rows = filteredTxns.map(t => [t.date, `"${t.details}"`, t.category, t.type, t.amount, t.status, `"${t.notes || ''}"`])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `fintrack-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const debits = getDebits(filteredTxns)
  const totalSpend = debits.reduce((s, t) => s + t.amount, 0)
  const totalReceived = filteredTxns.filter(t => t.type === 'Credit').reduce((s, t) => s + t.amount, 0)
  const net = totalReceived - totalSpend
  const { days } = getDateRange(filteredTxns)
  const catTotals = getCatTotals(debits)
  const { totals: merchantTotals, counts: merchantCounts } = getMerchantTotals(debits)
  const monthTotals = getMonthTotals(debits)
  const months = Object.keys(monthTotals).sort()

  // ── Donut chart ───────────────────────────────────────────────────────────
  function DonutChart() {
    const entries = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 8)
    const total = entries.reduce((s, [, v]) => s + v, 0)
    if (!total) return <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 12 }}>No data</div>
    const cx = 100, cy = 100, r = 70, strokeW = 28
    let angle = -90
    const arcs = entries.map(([cat, val]) => {
      const pct = val / total; const sweep = pct * 360
      const startA = angle * Math.PI / 180; const endA = (angle + sweep) * Math.PI / 180
      const x1 = cx + r * Math.cos(startA), y1 = cy + r * Math.sin(startA)
      const x2 = cx + r * Math.cos(endA), y2 = cy + r * Math.sin(endA)
      const large = sweep > 180 ? 1 : 0
      const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
      angle += sweep
      return { cat, val, pct, d }
    })
    return (
      <svg viewBox="0 0 200 200" width={200} height={200}>
        {arcs.map(({ cat, d }) => (
          <path key={cat} d={d} fill="none" stroke={CAT_COLORS[cat] || '#6b7280'} strokeWidth={strokeW} strokeLinecap="butt" />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="var(--text)" fontFamily="var(--font-sans)" fontSize={13} fontWeight={700}>{'\u20C3'}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--text)" fontFamily="var(--font-sans)" fontSize={11} fontWeight={600}>{Math.round(totalSpend / 1000)}K</text>
      </svg>
    )
  }

  const s = styles

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-sans)' }}>

      {/* Drag overlay */}
      {isDragging && (
        <div style={s.dropOverlay}>
          <div style={s.dropBox}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: 'var(--accent)' }}>Drop your Mashreq statement</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>.xlsx · new transactions merged automatically</div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ ...s.toast, borderColor: toast.error ? 'rgba(255,107,107,0.3)' : 'var(--border)' }}>
          <span style={{ fontSize: 18 }}>{toast.icon}</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{toast.title}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{toast.body}</div>
          </div>
        </div>
      )}

      <input type="file" ref={fileInputRef} accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />

      {/* Add transaction modal */}
      {showAddModal && (
        <Modal title="Add Transaction" onClose={() => setShowAddModal(false)}>
          <Field label="Date"><Input type="date" value={newTxn.date} onChange={v => setNewTxn(p => ({ ...p, date: v }))} /></Field>
          <Field label="Merchant / Details"><Input value={newTxn.details} onChange={v => setNewTxn(p => ({ ...p, details: v }))} placeholder="e.g. Deliveroo" /></Field>
          <Field label="Amount"><Input type="number" value={newTxn.amount} onChange={v => setNewTxn(p => ({ ...p, amount: v }))} placeholder="0.00" /></Field>
          <Field label="Type"><Select value={newTxn.type} onChange={v => setNewTxn(p => ({ ...p, type: v }))} options={['Debit', 'Credit']} /></Field>
          <Field label="Category"><Select value={newTxn.category} onChange={v => setNewTxn(p => ({ ...p, category: v }))} options={CATEGORIES} /></Field>
          <Field label="Status"><Select value={newTxn.status} onChange={v => setNewTxn(p => ({ ...p, status: v }))} options={['SETTLED', 'AUTHORIZED', 'REVERSED', 'IN_PROGRESS']} /></Field>
          <Field label="Notes"><Input value={newTxn.notes} onChange={v => setNewTxn(p => ({ ...p, notes: v }))} placeholder="Optional note..." /></Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <Btn onClick={addTxn} disabled={!newTxn.date || !newTxn.details || !newTxn.amount}>Add Transaction</Btn>
            <Btn onClick={() => setShowAddModal(false)} color="var(--surface2)">Cancel</Btn>
          </div>
        </Modal>
      )}

      {/* Bulk action modal */}
      {showBulkModal && (
        <Modal title={`Bulk Action — ${selected.size} selected`} onClose={() => setShowBulkModal(false)}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {(['recategorise', 'delete'] as const).map(a => (
              <button key={a} onClick={() => setBulkAction(a)} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${bulkAction === a ? 'var(--accent)' : 'var(--border)'}`, background: bulkAction === a ? 'rgba(0,229,160,0.08)' : 'none', color: bulkAction === a ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 500 }}>
                {a.charAt(0).toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
          {bulkAction === 'recategorise' && (
            <Field label="New Category">
              <Select value={bulkCategory} onChange={setBulkCategory} options={CATEGORIES} />
            </Field>
          )}
          {bulkAction === 'delete' && (
            <div style={{ padding: '12px 14px', background: 'rgba(255,107,107,0.08)', borderRadius: 8, border: '1px solid rgba(255,107,107,0.2)', fontSize: 12, color: 'var(--accent2)', marginBottom: 8 }}>
              This will permanently delete {selected.size} transactions. This cannot be undone.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            {bulkAction === 'recategorise'
              ? <Btn onClick={bulkRecategorise}>Apply to {selected.size} transactions</Btn>
              : <Btn onClick={bulkDelete} color="#e03e3e">Delete {selected.size} transactions</Btn>}
            <Btn onClick={() => setShowBulkModal(false)} color="var(--surface2)">Cancel</Btn>
          </div>
        </Modal>
      )}

      {/* Header */}
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: -0.5 }}>
            ADLY / <span style={{ color: 'var(--accent)' }}>FINTRACK</span>
          </div>
          <span style={s.dataBadge}>
            <span style={{ color: 'var(--accent)' }}>●</span>
            {txns.length} txns
          </span>
        </div>
        <div style={s.tabs}>
          {(['overview', 'categories', 'transactions', 'subscriptions', 'advisor'] as const).map(page => (
            <button key={page} style={{ ...s.tab, ...(activePage === page ? s.tabActive : {}) }}
              onClick={() => setActivePage(page)}>
              {page}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Theme toggle */}
          <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} style={s.themeToggle} aria-label="Toggle theme">
            <span style={{ ...s.themeKnob, background: theme === 'dark' ? '#7b8ff5' : '#f5c842', transform: theme === 'dark' ? 'translateX(0)' : 'translateX(16px)' }} />
          </button>
          <button onClick={() => setShowAddModal(true)} style={s.uploadBtn}>+ Add</button>
          <button onClick={() => { fileInputRef.current?.click() }} style={s.uploadBtn} disabled={uploading}>
            {uploading ? '⏳' : '↑'} Upload
          </button>
          <button onClick={exportCSV} style={s.uploadBtn}>↓ CSV</button>
          <button onClick={handleSignOut} style={s.signOutBtn}>Sign out</button>
        </div>
      </div>

      {/* Global filters bar */}
      <div style={{ padding: '10px 32px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const, background: 'var(--surface)' }}>
        <input value={globalSearch} onChange={e => { setGlobalSearch(e.target.value); setTxnPage(1) }} placeholder="Search all transactions..."
          style={{ ...s.searchInput, width: 220 }} />
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setTxnPage(1) }}
          style={{ ...s.searchInput, width: 140, fontSize: 11 }} title="From date" />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>→</span>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setTxnPage(1) }}
          style={{ ...s.searchInput, width: 140, fontSize: 11 }} title="To date" />
        <select value={catFilter} onChange={e => { setCatFilter(e.target.value); setTxnPage(1) }}
          style={{ ...s.searchInput, width: 160, appearance: 'none' as const }}>
          <option value="All">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(globalSearch || dateFrom || dateTo || catFilter !== 'All') && (
          <button onClick={() => { setGlobalSearch(''); setDateFrom(''); setDateTo(''); setCatFilter('All') }}
            style={{ fontSize: 11, color: 'var(--accent2)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '4px 8px' }}>
            ✕ Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{filteredTxns.length} of {txns.length} transactions</span>
      </div>

      {/* Page content */}
      <div style={{ padding: '28px 32px', maxWidth: 1400, margin: '0 auto' }}>

        {/* ── OVERVIEW ── */}
        {activePage === 'overview' && (
          <div>
            <SectionLabel>Financial Snapshot</SectionLabel>
            <div style={s.grid4}>
              <KPICard label="Total Spent" value={<D amount={totalSpend} />} sub={`${debits.length} debit transactions`} color="var(--accent2)" glow="red" />
              <KPICard label="Total Received" value={<D amount={totalReceived} />} sub="Credit payments & returns" color="var(--accent)" glow="green" />
              <KPICard label="Net Cash Flow" value={<span>{net >= 0 ? '+' : '-'}<D amount={Math.abs(net)} /></span>} sub={`${days}-day period`} color={net >= 0 ? 'var(--accent)' : 'var(--accent2)'} glow={net >= 0 ? 'green' : 'red'} />
              <KPICard label="Avg Daily Spend" value={<D amount={days > 0 ? totalSpend / days : 0} />} sub={<span><D amount={days > 0 ? totalSpend / days * 30 : 0} />/mo est.</span>} color="var(--accent3)" />
            </div>
            <div style={s.grid2}>
              <div style={s.card}>
                <div style={s.cardLabel}>Spending by Category</div>
                <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' as const }}>
                  <DonutChart />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    {Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([cat, val]) => (
                      <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLORS[cat] || '#6b7280', flexShrink: 0 }} />
                        <div style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{cat}</div>
                        <div style={{ fontSize: 12, color: 'var(--accent2)', fontWeight: 600 }}><D amount={val} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={s.card}>
                <div style={s.cardLabel}>Top Merchants by Spend</div>
                {Object.entries(merchantTotals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, amt]) => (
                  <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                    <div style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{m}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginRight: 4 }}>×{merchantCounts[m]}</div>
                    <div style={{ fontSize: 12, color: 'var(--accent2)', fontWeight: 600 }}><D amount={amt} /></div>
                  </div>
                ))}
              </div>
            </div>
            <div style={s.card}>
              <div style={s.cardLabel}>Monthly Spend Breakdown</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', overflowX: 'auto' as const, paddingBottom: 8 }}>
                {months.map((m, i) => {
                  const v = monthTotals[m]; const max = Math.max(...Object.values(monthTotals))
                  const h = Math.max(4, Math.round((v / max) * 120))
                  const c = MONTH_COLORS[i % MONTH_COLORS.length]
                  return (
                    <div key={m} style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 4, minWidth: 56 }}>
                      <div style={{ fontSize: 10, color: c, fontWeight: 600 }}><D amount={v / 1000} decimals={1} suffix="K" /></div>
                      <div title={dStr(v)} style={{ width: '100%', height: h, background: `${c}22`, border: `1px solid ${c}44`, borderBottom: `2px solid ${c}`, borderRadius: '4px 4px 0 0' }} />
                      <div style={{ fontSize: 9, color: 'var(--muted)' }}>{fmtMonth(m).slice(0, 3).toUpperCase()}</div>
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
            <SectionLabel>Category Breakdown + Budget Targets</SectionLabel>
            <div style={s.gridAuto}>
              {Object.entries(catTotals).sort((a, b) => b[1] - a[1]).map(([cat, total]) => {
                const budget = budgets[cat] || 0
                const pct = budget > 0 ? Math.min(100, (total / budget) * 100) : 0
                const over = budget > 0 && total > budget
                const color = CAT_COLORS[cat]
                return (
                  <div key={cat} style={s.card}>
                    <div style={s.cardLabel}>{CAT_ICONS[cat]} {cat}</div>
                    <div style={{ ...s.cardValue, fontSize: 22, color }}><D amount={total} /></div>
                    <div style={s.cardSub}>{debits.filter(t => t.category === cat).length} transactions</div>
                    {/* Budget input + progress */}
                    <div style={{ marginTop: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em' }}>BUDGET</span>
                        <BudgetInput value={budget} onSave={v => saveBudget(cat, v)} color={color} />
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>/mo</span>
                      </div>
                      {budget > 0 && (
                        <>
                          <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: over ? 'var(--accent2)' : color, borderRadius: 2, transition: 'width 0.4s' }} />
                          </div>
                          <div style={{ fontSize: 10, color: over ? 'var(--accent2)' : 'var(--muted)' }}>
                            {over ? `Over by ${dStr(total - budget)}` : `${dStr(budget - total)} remaining`}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Full breakdown bar chart */}
            <div style={s.card}>
              <div style={s.cardLabel}>Category Spend — Full Breakdown</div>
              {Object.entries(catTotals).sort((a, b) => b[1] - a[1]).map(([cat, val]) => {
                const max = Math.max(...Object.values(catTotals))
                const pct = Math.max(2, (val / max) * 100)
                return (
                  <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div style={{ width: 130, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span>{CAT_ICONS[cat]}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{cat}</span>
                    </div>
                    <div style={{ flex: 1, height: 6, background: 'var(--surface2)', borderRadius: 3 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: CAT_COLORS[cat] || '#6b7280', borderRadius: 3 }} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', width: 80, textAlign: 'right' as const }}><D amount={val} /></div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── TRANSACTIONS ── */}
        {activePage === 'transactions' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap' as const, gap: 10 }}>
              <SectionLabel>All Transactions</SectionLabel>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                {selected.size > 0 && (
                  <button onClick={() => setShowBulkModal(true)}
                    style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--accent3)', background: 'rgba(245,200,66,0.08)', color: 'var(--accent3)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: 500 }}>
                    {selected.size} selected ▸ bulk action
                  </button>
                )}
                {selected.size > 0 && (
                  <button onClick={() => setSelected(new Set())}
                    style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div style={{ overflowX: 'auto' as const }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
                <thead>
                  <tr>
                    <th style={s.th}>
                      <input type="checkbox" checked={selected.size === pageTxns.length && pageTxns.length > 0}
                        onChange={e => setSelected(e.target.checked ? new Set(pageTxns.map(t => t.id)) : new Set())} />
                    </th>
                    {(['date', 'details', 'category', 'amount', 'status'] as const).map(col => (
                      <th key={col} style={{ ...s.th, cursor: 'pointer', textAlign: col === 'amount' ? 'right' as const : 'left' as const, userSelect: 'none' as const }}
                        onClick={() => toggleSort(col)}>
                        {col.charAt(0).toUpperCase() + col.slice(1)}
                        {sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                      </th>
                    ))}
                    <th style={s.th}>Notes</th>
                    <th style={s.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {pageTxns.map(t => {
                    const isEditing = editingId === t.id
                    return (
                      <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', background: selected.has(t.id) ? 'rgba(0,229,160,0.03)' : 'transparent' }}>
                        {/* Checkbox */}
                        <td style={{ ...s.td, width: 32 }}>
                          <input type="checkbox" checked={selected.has(t.id)}
                            onChange={e => setSelected(prev => { const n = new Set(prev); e.target.checked ? n.add(t.id) : n.delete(t.id); return n })} />
                        </td>
                        {/* Date */}
                        <td style={{ ...s.td, width: 110 }}>
                          {isEditing
                            ? <input type="date" value={editDraft.date ?? t.date} onChange={e => setEditDraft(p => ({ ...p, date: e.target.value }))} style={s.inlineInput} />
                            : <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDate(t.date)}</span>}
                        </td>
                        {/* Merchant */}
                        <td style={{ ...s.td, maxWidth: 200 }}>
                          {isEditing
                            ? <input value={editDraft.details ?? t.details} onChange={e => setEditDraft(p => ({ ...p, details: e.target.value }))} style={s.inlineInput} />
                            : <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, display: 'block' }}>{t.details}</span>}
                        </td>
                        {/* Category */}
                        <td style={s.td}>
                          {isEditing
                            ? <select value={editDraft.category ?? t.category} onChange={e => setEditDraft(p => ({ ...p, category: e.target.value }))} style={s.inlineInput}>
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            : <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: `${CAT_COLORS[t.category]}18`, color: CAT_COLORS[t.category], fontWeight: 600, letterSpacing: '0.04em', whiteSpace: 'nowrap' as const }}>{t.category}</span>}
                        </td>
                        {/* Amount */}
                        <td style={{ ...s.td, textAlign: 'right' as const }}>
                          {isEditing
                            ? <input type="number" value={editDraft.amount ?? t.amount} onChange={e => setEditDraft(p => ({ ...p, amount: parseFloat(e.target.value) }))} style={{ ...s.inlineInput, width: 90, textAlign: 'right' as const }} />
                            : <span style={{ color: t.type === 'Debit' ? 'var(--accent2)' : 'var(--accent)', fontWeight: 600, fontSize: 12 }}>
                                {t.type === 'Credit' ? '+' : ''}<D amount={t.amount} />
                              </span>}
                        </td>
                        {/* Status */}
                        <td style={s.td}>
                          {isEditing
                            ? <select value={editDraft.status ?? t.status} onChange={e => setEditDraft(p => ({ ...p, status: e.target.value }))} style={s.inlineInput}>
                                {['SETTLED','AUTHORIZED','REVERSED','IN_PROGRESS'].map(s => <option key={s}>{s}</option>)}
                              </select>
                            : <span style={{ fontSize: 10, color: 'var(--muted)' }}>{t.status}</span>}
                        </td>
                        {/* Notes */}
                        <td style={{ ...s.td, maxWidth: 160 }}>
                          {isEditing
                            ? <input value={editDraft.notes ?? (t.notes || '')} onChange={e => setEditDraft(p => ({ ...p, notes: e.target.value }))} placeholder="Add note..." style={s.inlineInput} />
                            : <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: t.notes ? 'normal' : 'italic' as const, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, display: 'block', cursor: 'pointer' }}
                                onClick={() => { setEditingId(t.id); setEditDraft({ notes: t.notes || '' }) }}>
                                {t.notes || '+ note'}
                              </span>}
                        </td>
                        {/* Actions */}
                        <td style={{ ...s.td, width: 80 }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {isEditing ? (
                              <>
                                <button onClick={() => saveEdit(t.id)} style={s.actionBtn}>✓</button>
                                <button onClick={() => { setEditingId(null); setEditDraft({}) }} style={{ ...s.actionBtn, color: 'var(--muted)' }}>✕</button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => { setEditingId(t.id); setEditDraft({}) }} style={s.actionBtn} title="Edit">✎</button>
                                <button onClick={() => { if (confirm('Delete this transaction?')) deleteTxn(t.id) }} style={{ ...s.actionBtn, color: 'var(--accent2)' }} title="Delete">🗑</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, flexWrap: 'wrap' as const, gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {sortedTxns.length} transactions · page {txnPage} of {totalPages}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setTxnPage(1)} disabled={txnPage === 1} style={s.pageBtn}>«</button>
                <button onClick={() => setTxnPage(p => Math.max(1, p - 1))} disabled={txnPage === 1} style={s.pageBtn}>‹</button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = Math.max(1, Math.min(totalPages - 4, txnPage - 2)) + i
                  return <button key={p} onClick={() => setTxnPage(p)} style={{ ...s.pageBtn, ...(txnPage === p ? s.pageBtnActive : {}) }}>{p}</button>
                })}
                <button onClick={() => setTxnPage(p => Math.min(totalPages, p + 1))} disabled={txnPage === totalPages} style={s.pageBtn}>›</button>
                <button onClick={() => setTxnPage(totalPages)} disabled={txnPage === totalPages} style={s.pageBtn}>»</button>
              </div>
            </div>
          </div>
        )}

        {/* ── SUBSCRIPTIONS ── */}
        {activePage === 'subscriptions' && (
          <SubscriptionsPage txns={filteredTxns} />
        )}

        {/* ── ADVISOR ── */}
        {activePage === 'advisor' && (
          <div>
            <SectionLabel>AI Financial Advisor — Based on Your Data</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 16 }}>
              {getInsights(catTotals, merchantTotals, merchantCounts, monthTotals, months, totalSpend, totalReceived, days).map((ins, i) => (
                <div key={i} style={{ ...s.insightCard, borderLeftColor: ins.color }}>
                  <div style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>{ins.icon}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 5 }}>{ins.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>{ins.body}</div>
                    <span style={{ display: 'inline-block', marginTop: 8, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, padding: '3px 10px', borderRadius: 10, border: `1px solid ${ins.pillColor}22`, background: `${ins.pillColor}08`, color: ins.pillColor }}>{ins.pill}</span>
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

// ── Budget inline input ───────────────────────────────────────────────────────
function BudgetInput({ value, onSave, color }: { value: number; onSave: (v: number) => void; color: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value || ''))
  useEffect(() => { setDraft(String(value || '')) }, [value])
  if (!editing) return (
    <span onClick={() => setEditing(true)} style={{ fontSize: 12, color: value ? color : 'var(--muted)', cursor: 'pointer', fontWeight: value ? 600 : 400, borderBottom: '1px dashed var(--border)', paddingBottom: 1 }}>
      {value ? dStr(value) : 'Set budget'}
    </span>
  )
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input autoFocus type="number" value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={() => { onSave(parseFloat(draft) || 0); setEditing(false) }}
        onKeyDown={e => { if (e.key === 'Enter') { onSave(parseFloat(draft) || 0); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
        style={{ width: 80, background: 'var(--surface2)', border: `1px solid ${color}`, borderRadius: 6, padding: '2px 6px', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
    </span>
  )
}

// ── Subscriptions page ────────────────────────────────────────────────────────
const SUBS_CONFIG = [
  { name: 'Apple Services',      key: (t: Transaction) => t.details === 'APPLE.COM/BILL',             icon: '🍎', color: '#a8b2c1', note: 'Multiple charge amounts — family plan + apps' },
  { name: 'Netflix',             key: (t: Transaction) => t.details === 'NETFLIX.COM',                icon: '🎬', color: '#e50914', note: 'Streaming subscription' },
  { name: 'Spotify',             key: (t: Transaction) => t.details.startsWith('Spotify'),            icon: '🎵', color: '#1db954', note: 'Two account IDs — you and Laila' },
  { name: 'Adobe Premiere Pro',  key: (t: Transaction) => t.details === 'Adobe Premiere Pro',         icon: '🎞️', color: '#9999ff', note: 'Video editing' },
  { name: 'Adobe.com',           key: (t: Transaction) => t.details === 'Adobe.com',                  icon: '🅰️', color: '#ff0000', note: 'Separate Adobe product' },
  { name: 'Google One',          key: (t: Transaction) => t.details === 'Google One',                 icon: '🗂️', color: '#4285f4', note: 'Cloud storage' },
  { name: 'Google Workspace',    key: (t: Transaction) => t.details.includes('Google Workspace'),     icon: '📧', color: '#34a853', note: 'Business email' },
  { name: 'YouTube Premium',     key: (t: Transaction) => t.details === 'GOOGLE*YOUTUBE MEMBER',      icon: '▶️', color: '#ff0000', note: 'Ad-free YouTube' },
  { name: 'ChatGPT / OpenAI',    key: (t: Transaction) => t.details === 'OPENAI *CHATGPT SUBSCR',     icon: '🤖', color: '#00e5a0', note: 'AI subscription' },
  { name: 'Audible',             key: (t: Transaction) => t.details === 'Audible',                    icon: '🎧', color: '#f5a623', note: 'Audiobooks' },
  { name: 'PlayStation Network', key: (t: Transaction) => t.details === 'PlayStation Network',        icon: '🎮', color: '#003087', note: 'PS Plus / PS Now' },
  { name: 'Virgin Mobile',       key: (t: Transaction) => t.details.startsWith('Virgin Mobile'),      icon: '📱', color: '#e10a0a', note: 'Mobile plan — likely two SIMs' },
  { name: 'DU Mobile',           key: (t: Transaction) => t.details.startsWith('DU NO.'),             icon: '📶', color: '#6b2fa0', note: 'Mobile/home internet' },
  { name: 'DEWA',                key: (t: Transaction) => t.details.startsWith('DEWA') || t.details.startsWith('DUBAI ELECTRICITY'), icon: '⚡', color: '#f5c842', note: 'Electricity & water' },
  { name: 'Joga Bonito Academy', key: (t: Transaction) => t.details === 'JOGA BONITO ACADEMY LL',     icon: '⚽', color: '#34d399', note: 'Recurring activity fee' },
  { name: 'Mayfair Clinic',      key: (t: Transaction) => t.details === 'MAYFAIR CLINIC',             icon: '💉', color: '#f472b6', note: 'Mounjaro prescription' },
  { name: 'TABBY',               key: (t: Transaction) => t.details === 'TABBY',                      icon: '💳', color: '#6b7280', note: 'BNPL installments' },
]

function SubscriptionsPage({ txns }: { txns: Transaction[] }) {
  const debits = txns.filter(t => t.type === 'Debit' && t.status !== 'REVERSED')
  const months = [...new Set(debits.map(t => t.date.slice(0, 7)))].sort()
  const recentMonths = months.slice(-3)
  const subs = SUBS_CONFIG.map(cfg => {
    const matched = debits.filter(t => cfg.key(t))
    const total = matched.reduce((s, t) => s + t.amount, 0)
    const byMonth: Record<string, number> = {}
    months.forEach(m => { byMonth[m] = matched.filter(t => t.date.startsWith(m)).reduce((s, t) => s + t.amount, 0) })
    const nonZero = Object.values(byMonth).filter(v => v > 0)
    const monthly = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0
    return { ...cfg, total, byMonth, monthly }
  }).filter(s => s.total > 0)
  const monthlyBurn = subs.reduce((s, sub) => s + sub.monthly, 0)
  return (
    <div>
      <SectionLabel>Subscription Tracker — {subs.length} Recurring Charges Detected</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div style={styles.card}><div style={styles.cardLabel}>Est. Monthly Burn</div><div style={{ ...styles.cardValue, color: 'var(--accent2)', fontSize: 26 }}><D amount={monthlyBurn} /></div><div style={styles.cardSub}>across {subs.length} services</div></div>
        <div style={styles.card}><div style={styles.cardLabel}>Annual Projection</div><div style={{ ...styles.cardValue, color: 'var(--accent3)', fontSize: 26 }}><D amount={monthlyBurn * 12} /></div><div style={styles.cardSub}>if all continue unchanged</div></div>
        <div style={styles.card}><div style={styles.cardLabel}>Potential Savings</div><div style={{ ...styles.cardValue, color: 'var(--accent)', fontSize: 26 }}><D amount={monthlyBurn * 0.25} />/mo</div><div style={styles.cardSub}>cancel 3–4 low-use subs</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
        {subs.sort((a, b) => b.monthly - a.monthly).map(sub => {
          const hits = recentMonths.filter(m => (sub.byMonth[m] || 0) > 0).length
          const isActive = hits >= 2
          const statusColor = isActive ? 'var(--accent2)' : 'var(--accent3)'
          return (
            <div key={sub.name} style={{ background: 'var(--surface2)', borderRadius: 12, padding: 14, border: '1px solid var(--border)', borderLeft: `2px solid ${sub.color}55`, display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ fontSize: 20, lineHeight: 1 }}>{sub.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{sub.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{sub.note}</div>
                </div>
                <span style={{ fontSize: 8, letterSpacing: '0.1em', padding: '2px 7px', borderRadius: 8, background: `${statusColor}11`, color: statusColor, border: `1px solid ${statusColor}22`, flexShrink: 0 }}>{isActive ? 'ACTIVE' : 'SPORADIC'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {recentMonths.map(m => {
                    const v = sub.byMonth[m] || 0
                    return (
                      <div key={m} style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 3 }}>
                        <div title={v > 0 ? dStr(v) : '—'} style={{ width: 32, height: 32, borderRadius: 6, background: v > 0 ? `${sub.color}22` : 'var(--surface)', border: `1px solid ${v > 0 ? sub.color + '55' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: v > 0 ? sub.color : 'var(--muted)' }}>{v > 0 ? Math.round(v) : '–'}</div>
                        <div style={{ fontSize: 8, color: 'var(--muted)' }}>{fmtMonth(m).slice(0, 3)}</div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ textAlign: 'right' as const }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: sub.color }}><D amount={sub.monthly} /></div>
                  <div style={{ fontSize: 9, color: 'var(--muted)' }}>/month avg</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Insights ──────────────────────────────────────────────────────────────────
function getInsights(catTotals: Record<string,number>, merchantTotals: Record<string,number>, merchantCounts: Record<string,number>, monthTotals: Record<string,number>, months: string[], totalSpend: number, totalReceived: number, days: number) {
  const foodTotal = catTotals['Food & Dining'] || 0
  const foodPct = totalSpend > 0 ? Math.round((foodTotal / totalSpend) * 100) : 0
  const deliverooSpend = merchantTotals['Deliveroo'] || 0
  const subscTotal = catTotals['Tech & Subscriptions'] || 0
  const monthVals = months.map(m => monthTotals[m])
  const maxMonthVal = Math.max(...monthVals, 0)
  const maxMonthName = months.length ? fmtMonth(months[monthVals.indexOf(maxMonthVal)]) : '—'
  const net = totalReceived - totalSpend
  return [
    { icon: '🍽️', color: '#ff6b6b', title: `Food & Dining is your #1 expense — \u20C3 ${foodTotal.toFixed(0)}`, body: `${foodPct}% of your total spend goes to food. Deliveroo alone accounts for \u20C3 ${deliverooSpend.toFixed(0)} across ${merchantCounts['Deliveroo'] || 0} orders. Cutting 3 orders/week could save ~\u20C3 1,000/month.`, pill: '💡 Actionable', pillColor: '#f5c842' },
    { icon: '💻', color: '#60a5fa', title: `\u20C3 ${subscTotal.toFixed(0)} in tech subscriptions — audit needed`, body: `Apple services alone billed across multiple charges. Check for duplicate family plan charges or unused apps. A full audit could recover \u20C3 300–500/month.`, pill: '⚠️ Audit Now', pillColor: '#ff6b6b' },
    { icon: '📈', color: '#ff6b6b', title: `${maxMonthName} was your highest spend month — \u20C3 ${maxMonthVal.toFixed(0)}`, body: `Your spending varies significantly month to month. Track monthly totals regularly to distinguish one-off spikes from structural overspending patterns.`, pill: '📊 Context', pillColor: '#7b8ff5' },
    { icon: '💊', color: '#f472b6', title: `Mayfair Clinic: \u20C3 ${(merchantTotals['MAYFAIR CLINIC'] || 0).toFixed(0)} — Mounjaro costs`, body: `Recurring charges of \u20C3 1,499 suggest a monthly Mounjaro prescription. An intentional health investment. Verify whether your Four Seasons role includes healthcare benefits that could offset this.`, pill: '✅ Keep Going', pillColor: '#00e5a0' },
    { icon: '🏠', color: '#f5c842', title: `Net cash flow: ${net >= 0 ? '+' : ''}\u20C3 ${Math.abs(net).toFixed(0)}`, body: `Over ${days} days you received \u20C3 ${totalReceived.toFixed(0)} and spent \u20C3 ${totalSpend.toFixed(0)}. With a housing allowance covering rent, consistent savings of \u20C3 5,000–8,000/month toward a 1.5M property target is realistic.`, pill: '🏡 On Track', pillColor: '#00e5a0' },
    { icon: '🛍️', color: '#fbbf24', title: `Shopping hit \u20C3 ${(catTotals['Shopping'] || 0).toFixed(0)} — mostly impulse channels`, body: `Temu, Namshi, Amazon.ae, and Adidas spread across the period. Consider a monthly shopping cap of \u20C3 800 and a 24-hour rule before confirming online orders.`, pill: '💡 Set a Cap', pillColor: '#f5c842' },
    { icon: '💳', color: '#6b7280', title: `TABBY repayments: \u20C3 ${(merchantTotals['TABBY'] || 0).toFixed(0)} across multiple charges`, body: `Active BNPL installment plan. TABBY spending is invisible in real-time budgeting — ensure you're accounting for upcoming installments in your monthly outgoings.`, pill: '🔔 Track It', pillColor: '#6b7280' },
  ]
}

// ── Small components ──────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase' as const, color: 'var(--muted)', marginBottom: 16, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 10 }}>
      {children}
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

function KPICard({ label, value, sub, color, glow }: { label: string; value: React.ReactNode; sub: React.ReactNode; color: string; glow?: string }) {
  return (
    <div style={{ ...styles.card, position: 'relative', overflow: 'hidden' }}>
      {glow && <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: glow === 'red' ? 'rgba(255,107,107,0.07)' : glow === 'green' ? 'rgba(0,229,160,0.07)' : 'rgba(245,200,66,0.07)', filter: 'blur(20px)' }} />}
      <div style={styles.cardLabel}>{label}</div>
      <div style={{ ...styles.cardValue, color }}>{value}</div>
      <div style={styles.cardSub}>{sub}</div>
    </div>
  )
}

function SummaryCell({ val, label, color, small }: { val: React.ReactNode; label: string; color: string; small?: boolean }) {
  return (
    <div style={{ textAlign: 'center' as const }}>
      <div style={{ fontSize: small ? 11 : 15, fontWeight: 700, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{val}</div>
      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>{label}</div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  header: { position: 'sticky', top: 0, zIndex: 100, background: 'var(--header-bg)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--border)', padding: '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  tabs: { display: 'flex', gap: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4 },
  tab: { padding: '6px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500, color: 'var(--muted)', border: 'none', background: 'none', letterSpacing: '0.03em', textTransform: 'capitalize' as const },
  tabActive: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' },
  uploadBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, cursor: 'pointer', background: 'rgba(0,229,160,0.08)', border: '1px solid rgba(0,229,160,0.2)', color: 'var(--accent)', fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500 },
  signOutBtn: { padding: '6px 12px', borderRadius: 7, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: 'var(--font-sans)', fontSize: 11 },
  themeToggle: { width: 36, height: 20, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', position: 'relative', flexShrink: 0, outline: 'none' },
  themeKnob: { position: 'absolute', top: 2, left: 2, width: 14, height: 14, borderRadius: '50%', transition: 'transform 0.3s, background 0.3s', display: 'block' },
  dataBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, letterSpacing: '0.08em', padding: '3px 8px', borderRadius: 8, background: 'rgba(0,229,160,0.06)', border: '1px solid rgba(0,229,160,0.15)', color: 'var(--muted)', marginLeft: 6 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, position: 'relative', overflow: 'hidden' },
  cardLabel: { fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10, fontWeight: 500, fontFamily: 'var(--font-sans)' },
  cardValue: { fontFamily: 'var(--font-sans)', fontSize: 28, fontWeight: 700, lineHeight: 1, letterSpacing: -0.5 },
  cardSub: { fontSize: 11, color: 'var(--muted)', marginTop: 6 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 20 },
  gridAuto: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, marginBottom: 20 },
  dropOverlay: { position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(10,10,15,0.92)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 },
  dropBox: { border: '2px dashed var(--accent)', borderRadius: 20, padding: '60px 80px', textAlign: 'center' },
  toast: { position: 'fixed', bottom: 32, right: 32, zIndex: 1000, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.4)', maxWidth: 340 },
  searchInput: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-sans)', outline: 'none' },
  th: { padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 500, background: 'var(--surface)', textAlign: 'left' },
  td: { padding: '10px 12px', fontSize: 12 },
  inlineInput: { background: 'var(--surface2)', border: '1px solid var(--accent)', borderRadius: 6, padding: '4px 8px', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-sans)', outline: 'none', width: '100%' },
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--accent)', padding: '2px 4px', fontFamily: 'inherit' },
  pageBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
  pageBtnActive: { background: 'var(--accent)', color: '#000', borderColor: 'var(--accent)', fontWeight: 700 },
  insightCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--accent)', borderRadius: 12, padding: '16px 20px', display: 'flex', gap: 14, alignItems: 'flex-start' },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 16 },
}
