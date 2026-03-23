'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Transaction, CAT_COLORS, CAT_ICONS, fmtDate, fmtMonth } from '@/lib/utils'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'
import { DirhamSymbol } from '@/components/DirhamSymbol'

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface Budget { id?: string; category: string; monthly_limit: number }
interface Props {
  initialTransactions: Transaction[]
  initialBudgets: Budget[]
  userEmail: string
}
interface Toast { icon: string; title: string; body: string; error?: boolean }
type Page = 'overview' | 'categories' | 'transactions' | 'subscriptions' | 'advisor'
type SortKey = 'date' | 'details' | 'category' | 'amount'
type SortDir = 'asc' | 'desc'

const ALL_CATEGORIES = ['Food & Dining','Transport','Groceries','Shopping','Entertainment','Tech & Subscriptions','Utilities','Health & Fitness','Lifestyle','Other','Income']
const MONTH_COLORS = ['#7b8ff5','#ff6b6b','#f5c842','#34d399','#a78bfa','#fb923c','#60a5fa','#f472b6']

// ─── DIRHAM HELPERS ──────────────────────────────────────────────────────────
function D({ amount, decimals = 0, suffix = '' }: { amount: number; decimals?: number; suffix?: string }) {
  const num = decimals > 0 ? amount.toFixed(decimals) : Math.round(amount).toLocaleString()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.18em' }}>
      <DirhamSymbol /><span>{num}{suffix}</span>
    </span>
  )
}
function dStr(amount: number): string { return `\u20C3 ${Math.round(amount).toLocaleString()}` }

// ─── DATA HELPERS ─────────────────────────────────────────────────────────────
function getDebits(txns: Transaction[]) { return txns.filter(t => t.type === 'Debit' && t.status !== 'REVERSED') }
function getCatTotals(d: Transaction[]) { const r: Record<string,number>={};d.forEach(t=>{r[t.category]=(r[t.category]||0)+t.amount});return r }
function getMerchantTotals(d: Transaction[]) { const t: Record<string,number>={},c: Record<string,number>={};d.forEach(x=>{t[x.details]=(t[x.details]||0)+x.amount;c[x.details]=(c[x.details]||0)+1});return{totals:t,counts:c} }
function getMonthTotals(d: Transaction[]) { const r: Record<string,number>={};d.forEach(t=>{const m=t.date.slice(0,7);r[m]=(r[m]||0)+t.amount});return r }
function getDateRange(txns: Transaction[]) {
  if (!txns.length) return { min:'—', max:'—', days:0 }
  const dates = txns.map(t=>t.date).sort()
  const days = Math.round((new Date(dates[dates.length-1]).getTime()-new Date(dates[0]).getTime())/86400000)+1
  return { min:dates[0], max:dates[dates.length-1], days }
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div style={{ position:'fixed',inset:0,zIndex:2000,background:'rgba(0,0,0,0.7)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',padding:24 }} onClick={onClose}>
      <div style={{ background:'var(--surface)',border:'1px solid var(--border)',borderRadius:16,padding:28,width:'100%',maxWidth:480,maxHeight:'90vh',overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20 }}>
          <div style={{ fontSize:15,fontWeight:600 }}>{title}</div>
          <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--muted)',fontSize:18,lineHeight:1,padding:4 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── TRANSACTION FORM ────────────────────────────────────────────────────────
function TxnForm({ initial, onSave, onClose, loading }: {
  initial?: Partial<Transaction>
  onSave: (data: Partial<Transaction>) => void
  onClose: () => void
  loading: boolean
}) {
  const [form, setForm] = useState({
    date: initial?.date || new Date().toISOString().slice(0,10),
    details: initial?.details || '',
    amount: initial?.amount?.toString() || '',
    type: initial?.type || 'Debit',
    status: initial?.status || 'SETTLED',
    category: initial?.category || 'Food & Dining',
    notes: initial?.notes || '',
  })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const inp: React.CSSProperties = { width:'100%',background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',color:'var(--text)',fontSize:13,boxSizing:'border-box' as const,outline:'none' }
  const lbl: React.CSSProperties = { fontSize:10,letterSpacing:'0.12em',textTransform:'uppercase' as const,color:'var(--muted)',marginBottom:5,display:'block' }

  return (
    <div style={{ display:'flex',flexDirection:'column' as const,gap:14 }}>
      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
        <div><label style={lbl}>Date</label><input type="date" style={inp} value={form.date} onChange={e=>set('date',e.target.value)} /></div>
        <div><label style={lbl}>Amount</label><input type="number" step="0.01" style={inp} value={form.amount} onChange={e=>set('amount',e.target.value)} placeholder="0.00" /></div>
      </div>
      <div><label style={lbl}>Merchant / Details</label><input style={inp} value={form.details} onChange={e=>set('details',e.target.value)} placeholder="e.g. Deliveroo" /></div>
      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
        <div>
          <label style={lbl}>Type</label>
          <select style={inp} value={form.type} onChange={e=>set('type',e.target.value)}>
            <option value="Debit">Debit</option>
            <option value="Credit">Credit</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Status</label>
          <select style={inp} value={form.status} onChange={e=>set('status',e.target.value)}>
            {['SETTLED','AUTHORIZED','IN_PROGRESS','REVERSED','REFUNDED'].map(s=><option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label style={lbl}>Category</label>
        <select style={inp} value={form.category} onChange={e=>set('category',e.target.value)}>
          {ALL_CATEGORIES.map(c=><option key={c}>{c}</option>)}
        </select>
      </div>
      <div><label style={lbl}>Notes (optional)</label><textarea style={{ ...inp, resize:'vertical' as const, minHeight:64 }} value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Any note about this transaction..." /></div>
      <div style={{ display:'flex',gap:10,justifyContent:'flex-end',marginTop:4 }}>
        <button onClick={onClose} style={{ padding:'8px 18px',borderRadius:8,border:'1px solid var(--border)',background:'none',cursor:'pointer',color:'var(--muted)',fontSize:13 }}>Cancel</button>
        <button onClick={()=>onSave({ ...form, amount:parseFloat(form.amount) })} disabled={loading||!form.details||!form.amount} style={{ padding:'8px 18px',borderRadius:8,border:'none',background:'var(--accent)',color:'#000',cursor:'pointer',fontSize:13,fontWeight:600,opacity:loading?0.6:1 }}>
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DashboardClient({ initialTransactions, initialBudgets, userEmail }: Props) {
  const [txns, setTxns] = useState<Transaction[]>(initialTransactions)
  const [budgets, setBudgets] = useState<Budget[]>(initialBudgets)
  const [activePage, setActivePage] = useState<Page>('overview')
  const [theme, setTheme] = useState<'dark'|'light'>('dark')
  const [toast, setToast] = useState<Toast|null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [modalLoading, setModalLoading] = useState(false)

  // Transaction controls
  const [txnSearch, setTxnSearch] = useState('')
  const [txnFilter, setTxnFilter] = useState('all')
  const [txnCatFilter, setTxnCatFilter] = useState('all')
  const [txnPage, setTxnPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Global search / filter (drives all tabs)
  const [globalSearch, setGlobalSearch] = useState('')
  const [globalCat, setGlobalCat] = useState('all')
  const [globalDateFrom, setGlobalDateFrom] = useState('')
  const [globalDateTo, setGlobalDateTo] = useState('')

  // Modals
  const [editTxn, setEditTxn] = useState<Transaction|null>(null)
  const [addModal, setAddModal] = useState(false)
  const [budgetModal, setBudgetModal] = useState<string|null>(null) // category name
  const [budgetValue, setBudgetValue] = useState('')
  const [notesModal, setNotesModal] = useState<Transaction|null>(null)
  const [notesValue, setNotesValue] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const router = useRouter()
  const supabase = createClient()
  const PER_PAGE = 25

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('fintrack_theme') as 'dark'|'light'|null
    if (saved) setTheme(saved)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light')
    localStorage.setItem('fintrack_theme', theme)
  }, [theme])

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => { e.preventDefault(); setIsDragging(true) }
    const onDragLeave = (e: DragEvent) => { if (!e.relatedTarget) setIsDragging(false) }
    const onDragOver = (e: DragEvent) => e.preventDefault()
    const onDrop = (e: DragEvent) => { e.preventDefault(); setIsDragging(false); const f=e.dataTransfer?.files[0]; if(f) handleUpload(f) }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => { document.removeEventListener('dragenter', onDragEnter); document.removeEventListener('dragleave', onDragLeave); document.removeEventListener('dragover', onDragOver); document.removeEventListener('drop', onDrop) }
  }, [])

  // ── Helpers ───────────────────────────────────────────────────────────────
  function showToast(icon: string, title: string, body: string, error = false) {
    setToast({ icon, title, body, error })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  // Apply global filters
  const filteredTxns = useMemo(() => {
    let list = txns
    if (globalSearch) {
      const q = globalSearch.toLowerCase()
      list = list.filter(t => t.details.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || (t.notes||'').toLowerCase().includes(q))
    }
    if (globalCat !== 'all') list = list.filter(t => t.category === globalCat)
    if (globalDateFrom) list = list.filter(t => t.date >= globalDateFrom)
    if (globalDateTo) list = list.filter(t => t.date <= globalDateTo)
    return list
  }, [txns, globalSearch, globalCat, globalDateFrom, globalDateTo])

  // ── Upload ────────────────────────────────────────────────────────────────
  async function handleUpload(file: File) {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      showToast('❌', 'Wrong file type', 'Please upload a Mashreq .xlsx statement', true); return
    }
    setUploading(true)
    showToast('⏳', 'Processing…', `Reading ${file.name}`)
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    const json = await res.json()
    setUploading(false)
    if (!res.ok) { showToast('❌', 'Upload failed', json.error || 'Unknown error', true); return }
    showToast('✅', `Added ${json.added} transactions`, `${json.dupes} duplicates skipped`)
    const { data } = await supabase.from('transactions').select('*').order('date', { ascending: false })
    if (data) setTxns(data)
    router.refresh()
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function handleSaveEdit(data: Partial<Transaction>) {
    if (!editTxn?.id) return
    setModalLoading(true)
    const res = await fetch(`/api/transactions/${editTxn.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) })
    const json = await res.json()
    setModalLoading(false)
    if (!res.ok) { showToast('❌', 'Update failed', json.error, true); return }
    setTxns(prev => prev.map(t => t.id === editTxn.id ? json : t))
    setEditTxn(null)
    showToast('✅', 'Transaction updated', '')
  }

  async function handleAdd(data: Partial<Transaction>) {
    setModalLoading(true)
    const res = await fetch('/api/transactions', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) })
    const json = await res.json()
    setModalLoading(false)
    if (!res.ok) { showToast('❌', 'Add failed', json.error, true); return }
    setTxns(prev => [json, ...prev])
    setAddModal(false)
    showToast('✅', 'Transaction added', '')
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/transactions/${id}`, { method:'DELETE' })
    if (!res.ok) { showToast('❌', 'Delete failed', '', true); return }
    setTxns(prev => prev.filter(t => t.id !== id))
    showToast('🗑️', 'Deleted', '')
  }

  async function handleBulkDelete() {
    if (!selectedIds.size) return
    const ids = Array.from(selectedIds)
    await Promise.all(ids.map(id => fetch(`/api/transactions/${id}`, { method:'DELETE' })))
    setTxns(prev => prev.filter(t => !selectedIds.has(t.id!)))
    setSelectedIds(new Set())
    showToast('🗑️', `Deleted ${ids.length} transactions`, '')
  }

  async function handleBulkRecategorize(category: string) {
    if (!selectedIds.size) return
    const ids = Array.from(selectedIds)
    await Promise.all(ids.map(id => fetch(`/api/transactions/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ category }) })))
    setTxns(prev => prev.map(t => selectedIds.has(t.id!) ? { ...t, category } : t))
    setSelectedIds(new Set())
    showToast('✅', `Recategorized ${ids.length} transactions`, `→ ${category}`)
  }

  async function handleSaveNotes() {
    if (!notesModal?.id) return
    const res = await fetch(`/api/transactions/${notesModal.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ notes: notesValue }) })
    if (!res.ok) { showToast('❌', 'Failed to save note', '', true); return }
    setTxns(prev => prev.map(t => t.id === notesModal.id ? { ...t, notes: notesValue } : t))
    setNotesModal(null)
    showToast('✅', 'Note saved', '')
  }

  async function handleSaveBudget() {
    if (!budgetModal) return
    const limit = parseFloat(budgetValue)
    if (isNaN(limit) || limit <= 0) { showToast('❌', 'Invalid amount', '', true); return }
    const res = await fetch('/api/budgets', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ category: budgetModal, monthly_limit: limit }) })
    const json = await res.json()
    if (!res.ok) { showToast('❌', 'Save failed', json.error, true); return }
    setBudgets(prev => { const next = prev.filter(b=>b.category!==budgetModal); return [...next, { category: budgetModal, monthly_limit: limit }] })
    setBudgetModal(null)
    setBudgetValue('')
    showToast('✅', 'Budget set', `${budgetModal}: ${dStr(limit)}/mo`)
  }

  async function handleDeleteBudget(category: string) {
    await fetch('/api/budgets', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ category }) })
    setBudgets(prev => prev.filter(b => b.category !== category))
    showToast('🗑️', 'Budget removed', category)
  }

  async function handleSignOut() {
    await fetch('/api/signout', { method:'POST' }); router.push('/login')
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function exportCSV() {
    const headers = ['Date','Details','Amount','Type','Status','Category','Notes']
    const rows = filteredTxns.map(t => [t.date, `"${t.details.replace(/"/g,'""')}"`, t.amount, t.type, t.status, t.category, `"${(t.notes||'').replace(/"/g,'""')}"`])
    const csv = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='fintrack-export.csv'; a.click()
    showToast('📥', 'CSV exported', `${filteredTxns.length} transactions`)
  }

  // ── Sort handler ──────────────────────────────────────────────────────────
  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
    setTxnPage(1)
  }

  // ── Computed ──────────────────────────────────────────────────────────────
  const debits = getDebits(filteredTxns)
  const totalSpend = debits.reduce((s,t)=>s+t.amount,0)
  const totalReceived = filteredTxns.filter(t=>t.type==='Credit').reduce((s,t)=>s+t.amount,0)
  const net = totalReceived - totalSpend
  const catTotals = getCatTotals(debits)
  const { totals: merchantTotals, counts: merchantCounts } = getMerchantTotals(debits)
  const monthTotals = getMonthTotals(debits)
  const months = Object.keys(monthTotals).sort()
  const { days } = getDateRange(filteredTxns)

  // Sorted + filtered transactions list
  const txnList = useMemo(() => {
    let list = filteredTxns
    // local search on top of global
    if (txnSearch) { const q=txnSearch.toLowerCase(); list=list.filter(t=>t.details.toLowerCase().includes(q)||(t.notes||'').toLowerCase().includes(q)) }
    if (txnFilter !== 'all') list = list.filter(t => t.type === (txnFilter === 'debit' ? 'Debit' : 'Credit'))
    if (txnCatFilter !== 'all') list = list.filter(t => t.category === txnCatFilter)
    if (dateFrom) list = list.filter(t => t.date >= dateFrom)
    if (dateTo) list = list.filter(t => t.date <= dateTo)
    list = [...list].sort((a,b) => {
      let va: string|number = a[sortKey] as string|number
      let vb: string|number = b[sortKey] as string|number
      if (typeof va === 'string') va = va.toLowerCase()
      if (typeof vb === 'string') vb = vb.toLowerCase()
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
    })
    return list
  }, [filteredTxns, txnSearch, txnFilter, txnCatFilter, dateFrom, dateTo, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(txnList.length / PER_PAGE))
  const pageTxns = txnList.slice((txnPage-1)*PER_PAGE, txnPage*PER_PAGE)
  const allPageSelected = pageTxns.length > 0 && pageTxns.every(t => selectedIds.has(t.id!))

  const s = styles

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', color:'var(--text)', fontFamily:'var(--font-sans)' }}>

      {/* Drag overlay */}
      {isDragging && (
        <div style={s.dropOverlay}>
          <div style={s.dropBox}>
            <div style={{ fontSize:48, marginBottom:12 }}>📂</div>
            <div style={{ fontWeight:700, fontSize:22, color:'var(--accent)' }}>Drop your Mashreq statement</div>
            <div style={{ fontSize:12, color:'var(--muted)', marginTop:6 }}>.xlsx · new transactions merged automatically</div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ ...s.toast, borderColor: toast.error?'rgba(255,107,107,0.3)':'var(--border)' }}>
          <span style={{ fontSize:18 }}>{toast.icon}</span>
          <div>
            <div style={{ fontSize:12, fontWeight:700 }}>{toast.title}</div>
            {toast.body && <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>{toast.body}</div>}
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={e=>{ const f=e.target.files?.[0]; if(f) handleUpload(f); e.target.value='' }} />

      {/* Header */}
      <header style={s.header}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontWeight:800, fontSize:16, letterSpacing:'-0.3px' }}>
            ADLY / <span style={{ color:'var(--accent)' }}>FINTRACK</span>
          </div>
          <span style={s.dataBadge}>{filteredTxns.length} txns</span>
        </div>

        {/* Global filters */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flex:1, maxWidth:600, margin:'0 24px' }}>
          <input
            value={globalSearch}
            onChange={e=>{setGlobalSearch(e.target.value);setTxnPage(1)}}
            placeholder="Search across all tabs…"
            style={{ ...s.searchInput, flex:1, padding:'6px 12px' }}
          />
          <select value={globalCat} onChange={e=>{setGlobalCat(e.target.value);setTxnPage(1)}} style={{ ...s.searchInput, padding:'6px 10px', width:'auto', cursor:'pointer' }}>
            <option value="all">All categories</option>
            {ALL_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <input type="date" value={globalDateFrom} onChange={e=>setGlobalDateFrom(e.target.value)} style={{ ...s.searchInput, padding:'6px 8px', width:130 }} title="From date" />
          <input type="date" value={globalDateTo} onChange={e=>setGlobalDateTo(e.target.value)} style={{ ...s.searchInput, padding:'6px 8px', width:130 }} title="To date" />
          {(globalSearch||globalCat!=='all'||globalDateFrom||globalDateTo) && (
            <button onClick={()=>{setGlobalSearch('');setGlobalCat('all');setGlobalDateFrom('');setGlobalDateTo('')}} style={{ ...s.signOutBtn, color:'var(--accent2)', borderColor:'rgba(255,107,107,0.3)', whiteSpace:'nowrap' as const }}>Clear ✕</button>
          )}
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={()=>fileInputRef.current?.click()} style={s.uploadBtn} disabled={uploading}>
            {uploading ? '⏳' : '📂'} Upload
          </button>
          <button onClick={exportCSV} style={s.uploadBtn}>📥 Export</button>
          <button onClick={()=>setAddModal(true)} style={{ ...s.uploadBtn, background:'rgba(0,229,160,0.15)', borderColor:'rgba(0,229,160,0.4)', color:'var(--accent)', fontWeight:600 }}>+ Add</button>
          <button onClick={()=>setTheme(t=>t==='dark'?'light':'dark')} style={s.themeToggle} title="Toggle theme">
            <span style={{ ...s.themeKnob, background: theme==='dark'?'#6b6b85':'var(--accent)', transform: theme==='dark'?'translateX(0)':'translateX(16px)' }} />
          </button>
          <button onClick={handleSignOut} style={s.signOutBtn}>Sign out</button>
        </div>
      </header>

      {/* Tabs */}
      <div style={{ padding:'0 32px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:4 }}>
        {(['overview','categories','transactions','subscriptions','advisor'] as Page[]).map(page => (
          <button key={page} onClick={()=>setActivePage(page)} style={{ ...s.tab, ...(activePage===page ? s.tabActive : {}) }}>
            {page.charAt(0).toUpperCase()+page.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding:'28px 32px', maxWidth:1400, margin:'0 auto' }}>

        {/* ── OVERVIEW ── */}
        {activePage === 'overview' && (
          <div>
            <div style={s.grid4}>
              <KPICard label="Total Spent" value={<D amount={totalSpend}/>} sub={`${debits.length} debit transactions`} color="var(--accent2)" />
              <KPICard label="Total Received" value={<D amount={totalReceived}/>} sub="Credits & returns" color="var(--accent)" />
              <KPICard label="Net Cash Flow" value={<span>{net>=0?'+':'-'}<D amount={Math.abs(net)}/></span>} sub={`${days}-day period`} color={net>=0?'var(--accent)':'var(--accent2)'} />
              <KPICard label="Avg Daily Spend" value={<D amount={days>0?totalSpend/days:0}/>} sub={<span><D amount={days>0?totalSpend/days*30:0}/>/mo equivalent</span>} color="var(--accent3)" />
            </div>

            <div style={s.grid2}>
              {/* Donut */}
              <div style={s.card}>
                <div style={s.cardLabel}>Spending by Category</div>
                <DonutChart catTotals={catTotals} totalSpend={totalSpend} />
              </div>

              {/* Top merchants */}
              <div style={s.card}>
                <div style={s.cardLabel}>Top Merchants by Spend</div>
                {Object.entries(merchantTotals).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([m,amt])=>(
                  <div key={m} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                    <div style={{ flex:1, fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{m}</div>
                    <div style={{ fontSize:11, color:'var(--muted)' }}>{merchantCounts[m]}×</div>
                    <div style={{ fontSize:12, color:'var(--accent2)', fontWeight:700, width:80, textAlign:'right' as const }}><D amount={amt}/></div>
                  </div>
                ))}
              </div>
            </div>

            {/* Monthly bars */}
            <div style={s.card}>
              <div style={s.cardLabel}>Monthly Spend Breakdown</div>
              <div style={{ display:'flex', gap:8, alignItems:'flex-end', height:160, paddingTop:12 }}>
                {months.map((m,i)=>{
                  const v=monthTotals[m],maxV=Math.max(...Object.values(monthTotals),1)
                  const h=Math.max(4,Math.round((v/maxV)*130))
                  const c=MONTH_COLORS[i%MONTH_COLORS.length]
                  return (
                    <div key={m} style={{ flex:1, display:'flex', flexDirection:'column' as const, alignItems:'center', gap:4 }}>
                      <div style={{ fontSize:9, color:c }}><D amount={v/1000} decimals={1} suffix="K"/></div>
                      <div title={dStr(v)} style={{ width:'100%', height:h, background:`${c}22`, border:`1px solid ${c}44`, borderBottom:`2px solid ${c}`, borderRadius:'4px 4px 0 0', minHeight:2 }}/>
                      <div style={{ fontSize:9, color:'var(--muted)', letterSpacing:'0.05em' }}>{fmtMonth(m).slice(0,3).toUpperCase()}</div>
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
            <SectionLabel>Category Breakdown</SectionLabel>
            <div style={s.gridAuto}>
              {Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).map(([cat,total])=>{
                const budget = budgets.find(b=>b.category===cat)
                const months_active = months.filter(m=>filteredTxns.filter(t=>t.type==='Debit'&&t.category===cat&&t.date.startsWith(m)).length>0)
                const avg = months_active.length ? total/months_active.length : total
                const pct = budget ? Math.min(100,Math.round((avg/budget.monthly_limit)*100)) : null
                return (
                  <div key={cat} style={{ ...s.card, borderLeft:`2px solid ${CAT_COLORS[cat]||'var(--border)'}` }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                      <div style={s.cardLabel}>{CAT_ICONS[cat]} {cat.toUpperCase()}</div>
                      <button onClick={()=>{setBudgetModal(cat);setBudgetValue(budget?.monthly_limit.toString()||'')}} style={{ fontSize:10, padding:'2px 8px', borderRadius:6, border:'1px solid var(--border)', background:'none', cursor:'pointer', color:'var(--muted)' }}>
                        {budget ? `Budget: ${dStr(budget.monthly_limit)}` : '+ Budget'}
                      </button>
                    </div>
                    <div style={{ ...s.cardValue, fontSize:22, color:CAT_COLORS[cat] }}><D amount={total}/></div>
                    <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>~<D amount={avg}/>/mo avg</div>
                    {budget && pct !== null && (
                      <div style={{ marginTop:10 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--muted)', marginBottom:4 }}>
                          <span>vs budget</span>
                          <span style={{ color: pct>100?'var(--accent2)':pct>80?'var(--accent3)':'var(--accent)' }}>{pct}%</span>
                        </div>
                        <div style={{ height:4, background:'var(--border)', borderRadius:2 }}>
                          <div style={{ height:'100%', width:`${Math.min(100,pct)}%`, borderRadius:2, background: pct>100?'var(--accent2)':pct>80?'var(--accent3)':'var(--accent)', transition:'width 0.4s' }}/>
                        </div>
                        {budget && <button onClick={()=>handleDeleteBudget(cat)} style={{ fontSize:9, color:'var(--muted)', background:'none', border:'none', cursor:'pointer', marginTop:4, padding:0 }}>remove budget</button>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Full breakdown bar chart */}
            <div style={s.card}>
              <div style={s.cardLabel}>Category vs Monthly Trend</div>
              {Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).map(([cat,val])=>{
                const maxV = Math.max(...Object.values(catTotals),1)
                const w = Math.round((val/maxV)*100)
                const color = CAT_COLORS[cat]||'var(--accent4)'
                return (
                  <div key={cat} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                    <div style={{ width:140, fontSize:11, color:'var(--muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{cat}</div>
                    <div style={{ flex:1, height:6, background:'var(--border)', borderRadius:3 }}>
                      <div style={{ height:'100%', width:`${w}%`, background:color, borderRadius:3 }}/>
                    </div>
                    <div style={{ fontSize:11, color:'var(--muted)', width:70, textAlign:'right' as const }}><D amount={val}/></div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── TRANSACTIONS ── */}
        {activePage === 'transactions' && (
          <div>
            {/* Filters row */}
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' as const, marginBottom:16, alignItems:'center' }}>
              <input value={txnSearch} onChange={e=>{setTxnSearch(e.target.value);setTxnPage(1)}} placeholder="Search transactions…" style={{ ...s.searchInput, width:200 }}/>
              {(['all','debit','credit'] as const).map(f=>(
                <button key={f} onClick={()=>{setTxnFilter(f);setTxnPage(1)}} style={{ ...s.filterBtn, ...(txnFilter===f?s.filterBtnActive:{}) }}>{f.toUpperCase()}</button>
              ))}
              <select value={txnCatFilter} onChange={e=>{setTxnCatFilter(e.target.value);setTxnPage(1)}} style={{ ...s.searchInput, padding:'5px 8px', width:'auto', cursor:'pointer' }}>
                <option value="all">All categories</option>
                {ALL_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
              <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{ ...s.searchInput, padding:'5px 8px', width:130 }} title="From"/>
              <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{ ...s.searchInput, padding:'5px 8px', width:130 }} title="To"/>
              <div style={{ marginLeft:'auto', fontSize:11, color:'var(--muted)' }}>{txnList.length} results</div>
            </div>

            {/* Bulk actions */}
            {selectedIds.size > 0 && (
              <div style={{ display:'flex', gap:8, marginBottom:12, padding:'10px 14px', background:'var(--surface2)', borderRadius:10, border:'1px solid var(--border)', alignItems:'center', flexWrap:'wrap' as const }}>
                <span style={{ fontSize:12, fontWeight:600 }}>{selectedIds.size} selected</span>
                <select defaultValue="" onChange={e=>{ if(e.target.value) handleBulkRecategorize(e.target.value); e.target.value='' }} style={{ ...s.searchInput, padding:'4px 8px', width:'auto', cursor:'pointer', fontSize:11 }}>
                  <option value="" disabled>Recategorize → …</option>
                  {ALL_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={handleBulkDelete} style={{ padding:'4px 12px', borderRadius:6, border:'1px solid rgba(255,107,107,0.3)', background:'none', cursor:'pointer', color:'var(--accent2)', fontSize:11 }}>Delete selected</button>
                <button onClick={()=>setSelectedIds(new Set())} style={{ padding:'4px 10px', borderRadius:6, border:'1px solid var(--border)', background:'none', cursor:'pointer', color:'var(--muted)', fontSize:11, marginLeft:'auto' }}>Clear</button>
              </div>
            )}

            {/* Table */}
            <div style={{ overflowX:'auto' as const }}>
              <table style={{ width:'100%', borderCollapse:'collapse' as const }}>
                <thead>
                  <tr>
                    <th style={{ ...s.th, width:36 }}>
                      <input type="checkbox" checked={allPageSelected} onChange={e=>{ if(e.target.checked) setSelectedIds(prev=>new Set([...prev,...pageTxns.map(t=>t.id!)])); else setSelectedIds(prev=>{ const n=new Set(prev); pageTxns.forEach(t=>n.delete(t.id!)); return n }) }} style={{ cursor:'pointer' }}/>
                    </th>
                    {([['date','Date'],['details','Merchant'],['category','Category'],['status','Status'],['amount','Amount'],['notes','Notes'],['actions','']] as [SortKey|'notes'|'actions', string][]).map(([k,label])=>(
                      <th key={k} style={{ ...s.th, textAlign: k==='amount'?'right' as const:'left' as const, cursor: ['date','details','category','amount'].includes(k)?'pointer':'default' }}
                        onClick={()=>{ if(['date','details','category','amount'].includes(k)) handleSort(k as SortKey) }}>
                        {label}{k===sortKey ? (sortDir==='asc'?' ↑':' ↓') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageTxns.map(t=>(
                    <tr key={t.id} style={{ borderBottom:'1px solid var(--border)', background: selectedIds.has(t.id!)?'rgba(0,229,160,0.04)':'transparent' }}>
                      <td style={s.td}>
                        <input type="checkbox" checked={selectedIds.has(t.id!)} onChange={e=>{ const n=new Set(selectedIds); e.target.checked?n.add(t.id!):n.delete(t.id!); setSelectedIds(n) }} style={{ cursor:'pointer' }}/>
                      </td>
                      <td style={{ ...s.td, color:'var(--muted)', whiteSpace:'nowrap' as const }}>{fmtDate(t.date)}</td>
                      <td style={{ ...s.td, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{t.details}</td>
                      <td style={s.td}>
                        <span style={{ fontSize:10, padding:'2px 7px', borderRadius:8, background:`${CAT_COLORS[t.category]||'#888'}18`, color:CAT_COLORS[t.category]||'var(--muted)', border:`1px solid ${CAT_COLORS[t.category]||'#888'}33` }}>
                          {t.category}
                        </span>
                      </td>
                      <td style={s.td}>
                        <span style={{ fontSize:9, padding:'2px 6px', borderRadius:6, background:'var(--surface2)', color:'var(--muted)' }}>{t.status}</span>
                      </td>
                      <td style={{ ...s.td, textAlign:'right' as const, color:t.type==='Debit'?'var(--accent2)':'var(--accent)', fontWeight:600 }}>
                        {t.type==='Debit'?'-':'+' }<D amount={t.amount} decimals={2}/>
                      </td>
                      <td style={{ ...s.td, maxWidth:140 }}>
                        <button onClick={()=>{ setNotesModal(t); setNotesValue(t.notes||'') }} style={{ background:'none', border:'none', cursor:'pointer', color: t.notes?'var(--accent3)':'var(--muted)', fontSize:11, padding:'2px 6px', borderRadius:4, textAlign:'left' as const, maxWidth:130, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>
                          {t.notes || '+ note'}
                        </button>
                      </td>
                      <td style={{ ...s.td, whiteSpace:'nowrap' as const }}>
                        <button onClick={()=>setEditTxn(t)} style={{ padding:'3px 8px', fontSize:10, borderRadius:5, border:'1px solid var(--border)', background:'none', cursor:'pointer', color:'var(--muted)', marginRight:4 }}>Edit</button>
                        <button onClick={()=>{ if(confirm('Delete this transaction?')) handleDelete(t.id!) }} style={{ padding:'3px 8px', fontSize:10, borderRadius:5, border:'1px solid rgba(255,107,107,0.3)', background:'none', cursor:'pointer', color:'var(--accent2)' }}>Del</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:16, fontSize:12, color:'var(--muted)' }}>
              <span>Page {txnPage} of {totalPages} · {txnList.length} transactions</span>
              <div style={{ display:'flex', gap:6 }}>
                <button disabled={txnPage===1} onClick={()=>setTxnPage(1)} style={s.pageBtn}>«</button>
                <button disabled={txnPage===1} onClick={()=>setTxnPage(p=>p-1)} style={s.pageBtn}>‹</button>
                {Array.from({length:Math.min(5,totalPages)},(_,i)=>{
                  const p=txnPage<=3?i+1:txnPage+i-2
                  if(p<1||p>totalPages) return null
                  return <button key={p} onClick={()=>setTxnPage(p)} style={{ ...s.pageBtn, ...(p===txnPage?{background:'var(--accent)', color:'#000', borderColor:'var(--accent)'}:{}) }}>{p}</button>
                })}
                <button disabled={txnPage===totalPages} onClick={()=>setTxnPage(p=>p+1)} style={s.pageBtn}>›</button>
                <button disabled={txnPage===totalPages} onClick={()=>setTxnPage(totalPages)} style={s.pageBtn}>»</button>
              </div>
            </div>
          </div>
        )}

        {/* ── SUBSCRIPTIONS ── */}
        {activePage === 'subscriptions' && <SubscriptionsPage txns={filteredTxns} />}

        {/* ── ADVISOR ── */}
        {activePage === 'advisor' && (
          <div>
            <SectionLabel>AI Financial Advisor — Based on Your Data</SectionLabel>
            <div style={{ display:'flex', flexDirection:'column' as const, gap:16 }}>
              {getInsights(catTotals,merchantTotals,merchantCounts,monthTotals,months,totalSpend,totalReceived,days).map((ins,i)=>(
                <div key={i} style={{ ...s.insightCard, borderLeftColor:ins.color }}>
                  <div style={{ fontSize:20, flexShrink:0, marginTop:2 }}>{ins.icon}</div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, marginBottom:5 }}>{ins.title}</div>
                    <div style={{ fontSize:11, color:'var(--muted)', lineHeight:1.6 }}>{ins.body}</div>
                    <span style={{ display:'inline-block', marginTop:8, fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase' as const, padding:'3px 10px', borderRadius:10, border:`1px solid ${ins.pillColor}22`, background:`${ins.pillColor}08`, color:ins.pillColor }}>
                      {ins.pill}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── MODALS ── */}
      {editTxn && (
        <Modal title="Edit Transaction" onClose={()=>setEditTxn(null)}>
          <TxnForm initial={editTxn} onSave={handleSaveEdit} onClose={()=>setEditTxn(null)} loading={modalLoading}/>
        </Modal>
      )}

      {addModal && (
        <Modal title="Add Transaction" onClose={()=>setAddModal(false)}>
          <TxnForm onSave={handleAdd} onClose={()=>setAddModal(false)} loading={modalLoading}/>
        </Modal>
      )}

      {notesModal && (
        <Modal title="Transaction Note" onClose={()=>setNotesModal(null)}>
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:10 }}>{notesModal.details} · {fmtDate(notesModal.date)}</div>
          <textarea
            value={notesValue}
            onChange={e=>setNotesValue(e.target.value)}
            placeholder="Add a note about this transaction…"
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', color:'var(--text)', fontSize:13, minHeight:100, resize:'vertical' as const, outline:'none', boxSizing:'border-box' as const }}
            autoFocus
          />
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:14 }}>
            <button onClick={()=>setNotesModal(null)} style={{ padding:'8px 18px', borderRadius:8, border:'1px solid var(--border)', background:'none', cursor:'pointer', color:'var(--muted)', fontSize:13 }}>Cancel</button>
            <button onClick={handleSaveNotes} style={{ padding:'8px 18px', borderRadius:8, border:'none', background:'var(--accent)', color:'#000', cursor:'pointer', fontSize:13, fontWeight:600 }}>Save Note</button>
          </div>
        </Modal>
      )}

      {budgetModal && (
        <Modal title={`Set Budget — ${budgetModal}`} onClose={()=>setBudgetModal(null)}>
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:14 }}>Monthly spending limit for this category.</div>
          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <DirhamSymbol size="1.2em"/>
            <input
              type="number" min="0" step="50"
              value={budgetValue}
              onChange={e=>setBudgetValue(e.target.value)}
              placeholder="e.g. 2000"
              autoFocus
              style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', color:'var(--text)', fontSize:16, outline:'none' }}
            />
            <span style={{ fontSize:12, color:'var(--muted)' }}>/mo</span>
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:16 }}>
            <button onClick={()=>setBudgetModal(null)} style={{ padding:'8px 18px', borderRadius:8, border:'1px solid var(--border)', background:'none', cursor:'pointer', color:'var(--muted)', fontSize:13 }}>Cancel</button>
            <button onClick={handleSaveBudget} disabled={!budgetValue} style={{ padding:'8px 18px', borderRadius:8, border:'none', background:'var(--accent)', color:'#000', cursor:'pointer', fontSize:13, fontWeight:600, opacity:!budgetValue?0.5:1 }}>Save Budget</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── DONUT CHART ─────────────────────────────────────────────────────────────
function DonutChart({ catTotals, totalSpend }: { catTotals: Record<string,number>; totalSpend: number }) {
  const cx=120,cy=120,r=90,stroke=28
  const entries = Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).slice(0,8)
  let offset=0
  const circumference=2*Math.PI*r
  const segments = entries.map(([cat,val])=>{ const pct=val/totalSpend; const o=offset; offset+=pct; return { cat,val,pct,offset:o } })
  return (
    <div style={{ display:'flex', alignItems:'center', gap:24 }}>
      <svg width={240} height={240} viewBox="0 0 240 240">
        {segments.map(({cat,pct,offset:o})=>(
          <circle key={cat} cx={cx} cy={cy} r={r} fill="none" stroke={CAT_COLORS[cat]||'#888'} strokeWidth={stroke}
            strokeDasharray={`${pct*circumference} ${circumference}`}
            strokeDashoffset={-o*circumference} transform={`rotate(-90 ${cx} ${cy})`} style={{ transition:'stroke-dasharray 0.4s' }}/>
        ))}
        <text x={cx} y={cy-6} textAnchor="middle" fill="var(--text)" fontFamily="var(--font-sans)" fontSize={13} fontWeight={700}>{'\u20C3'}</text>
        <text x={cx} y={cy+10} textAnchor="middle" fill="var(--text)" fontFamily="var(--font-sans)" fontSize={11} fontWeight={600}>{Math.round(totalSpend/1000)}K</text>
      </svg>
      <div style={{ display:'flex', flexDirection:'column' as const, gap:6 }}>
        {segments.map(({cat,val,pct})=>(
          <div key={cat} style={{ display:'flex', alignItems:'center', gap:8, fontSize:11 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:CAT_COLORS[cat]||'#888', flexShrink:0 }}/>
            <div style={{ color:'var(--muted)', width:110, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{cat}</div>
            <div style={{ color:'var(--text)', fontWeight:500 }}>{Math.round(pct*100)}%</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── SUBSCRIPTIONS ────────────────────────────────────────────────────────────
const SUBS_CONFIG = [
  { name:'Apple Services',     key:(t:Transaction)=>t.details==='APPLE.COM/BILL',           icon:'🍎',color:'#a8b2c1',note:'iCloud, App Store, Apple One' },
  { name:'Netflix',            key:(t:Transaction)=>t.details==='NETFLIX.COM',              icon:'🎬',color:'#e50914',note:'Streaming' },
  { name:'Spotify',            key:(t:Transaction)=>t.details.startsWith('Spotify'),        icon:'🎵',color:'#1db954',note:'Music' },
  { name:'Adobe Premiere Pro', key:(t:Transaction)=>t.details==='Adobe Premiere Pro',       icon:'🎞️',color:'#9999ff',note:'Video editing' },
  { name:'Adobe.com',          key:(t:Transaction)=>t.details==='Adobe.com',                icon:'🅰️',color:'#ff0000',note:'Adobe product' },
  { name:'Google One',         key:(t:Transaction)=>t.details==='Google One',               icon:'🗂️',color:'#4285f4',note:'Cloud storage' },
  { name:'Google Workspace',   key:(t:Transaction)=>t.details.includes('Google Workspace'), icon:'📧',color:'#34a853',note:'Business email' },
  { name:'YouTube Premium',    key:(t:Transaction)=>t.details==='GOOGLE*YOUTUBE MEMBER',    icon:'▶️',color:'#ff0000',note:'Ad-free YouTube' },
  { name:'ChatGPT',            key:(t:Transaction)=>t.details==='OPENAI *CHATGPT SUBSCR',   icon:'🤖',color:'#00e5a0',note:'AI subscription' },
  { name:'Audible',            key:(t:Transaction)=>t.details==='Audible',                  icon:'🎧',color:'#f5a623',note:'Audiobooks' },
  { name:'PlayStation',        key:(t:Transaction)=>t.details==='PlayStation Network',      icon:'🎮',color:'#003087',note:'PS Plus' },
  { name:'Virgin Mobile',      key:(t:Transaction)=>t.details.startsWith('Virgin Mobile'), icon:'📱',color:'#e10a0a',note:'Mobile plan' },
  { name:'DU Mobile',          key:(t:Transaction)=>t.details.startsWith('DU NO.'),         icon:'📶',color:'#6b2fa0',note:'Mobile/internet' },
  { name:'DEWA',               key:(t:Transaction)=>t.details.startsWith('DEWA')||t.details.startsWith('DUBAI ELECTRICITY'),icon:'⚡',color:'#f5c842',note:'Electricity & water' },
  { name:'Mayfair Clinic',     key:(t:Transaction)=>t.details==='MAYFAIR CLINIC',           icon:'💉',color:'#f472b6',note:'Mounjaro prescription' },
  { name:'TABBY',              key:(t:Transaction)=>t.details==='TABBY',                    icon:'💳',color:'#6b7280',note:'BNPL installments' },
]

function SubscriptionsPage({ txns }: { txns: Transaction[] }) {
  const debits=txns.filter(t=>t.type==='Debit'&&t.status!=='REVERSED')
  const months=[...new Set(debits.map(t=>t.date.slice(0,7)))].sort()
  const recentMonths=months.slice(-3)
  const subs=SUBS_CONFIG.map(cfg=>{
    const matched=debits.filter(t=>cfg.key(t))
    const total=matched.reduce((s,t)=>s+t.amount,0)
    const byMonth: Record<string,number>={}
    months.forEach(m=>{ byMonth[m]=matched.filter(t=>t.date.startsWith(m)).reduce((s,t)=>s+t.amount,0) })
    const nonZero=Object.values(byMonth).filter(v=>v>0)
    const monthly=nonZero.length?nonZero.reduce((a,b)=>a+b,0)/nonZero.length:0
    return {...cfg,total,byMonth,monthly}
  }).filter(s=>s.total>0)

  const monthlyBurn=subs.reduce((s,sub)=>s+sub.monthly,0)

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, marginBottom:24 }}>
        <KPICard label="Est. Monthly Burn" value={<D amount={monthlyBurn}/>} sub={`across ${subs.length} services`} color="var(--accent2)"/>
        <KPICard label="Annual Projection" value={<D amount={monthlyBurn*12}/>} sub="if all continue" color="var(--accent3)"/>
        <KPICard label="Potential Savings" value={<D amount={monthlyBurn*0.25}/>} sub="cancel 3–4 low-use" color="var(--accent)"/>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:12 }}>
        {subs.sort((a,b)=>b.monthly-a.monthly).map(sub=>{
          const hits=recentMonths.filter(m=>(sub.byMonth[m]||0)>0).length
          const isActive=hits>=2
          const sc=isActive?'var(--accent2)':'var(--accent3)'
          return (
            <div key={sub.name} style={{ background:'var(--surface2)', borderRadius:12, padding:14, border:'1px solid var(--border)', borderLeft:`2px solid ${sub.color}55` }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
                <div style={{ fontSize:18 }}>{sub.icon}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{sub.name}</div>
                  <div style={{ fontSize:10, color:'var(--muted)', marginTop:2 }}>{sub.note}</div>
                </div>
                <span style={{ fontSize:8, letterSpacing:'0.1em', padding:'2px 7px', borderRadius:8, background:`${sc}11`, color:sc, border:`1px solid ${sc}22`, flexShrink:0 }}>{isActive?'ACTIVE':'SPORADIC'}</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ display:'flex', gap:5 }}>
                  {recentMonths.map(m=>{ const v=sub.byMonth[m]||0; return (
                    <div key={m} style={{ display:'flex', flexDirection:'column' as const, alignItems:'center', gap:3 }}>
                      <div title={v>0?dStr(v):'—'} style={{ width:34, height:34, borderRadius:6, background:v>0?`${sub.color}22`:'var(--surface)', border:`1px solid ${v>0?sub.color+'55':'var(--border)'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, color:v>0?sub.color:'var(--muted)' }}>
                        {v>0?Math.round(v):'–'}
                      </div>
                      <div style={{ fontSize:8, color:'var(--muted)' }}>{fmtMonth(m).slice(0,3)}</div>
                    </div>
                  )})}
                </div>
                <div style={{ textAlign:'right' as const }}>
                  <div style={{ fontSize:15, fontWeight:700, color:sub.color }}><D amount={sub.monthly}/></div>
                  <div style={{ fontSize:9, color:'var(--muted)' }}>/mo avg</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── INSIGHTS ────────────────────────────────────────────────────────────────
function getInsights(catTotals: Record<string,number>,merchantTotals: Record<string,number>,merchantCounts: Record<string,number>,monthTotals: Record<string,number>,months: string[],totalSpend: number,totalReceived: number,days: number) {
  const foodTotal=catTotals['Food & Dining']||0
  const foodPct=totalSpend>0?Math.round(foodTotal/totalSpend*100):0
  const deliverooSpend=merchantTotals['Deliveroo']||0
  const subscTotal=catTotals['Tech & Subscriptions']||0
  const monthVals=months.map(m=>monthTotals[m])
  const maxMonthVal=Math.max(...monthVals,0)
  const maxMonthName=months.length?fmtMonth(months[monthVals.indexOf(maxMonthVal)]):'—'
  const net=totalReceived-totalSpend
  return [
    { icon:'🍽️',color:'#ff6b6b',title:`Food & Dining is your #1 expense — \u20C3 ${foodTotal.toFixed(0)}`,body:`${foodPct}% of total spend goes to food. Deliveroo alone accounts for \u20C3 ${deliverooSpend.toFixed(0)} across ${merchantCounts['Deliveroo']||0} orders. Cutting 3 orders/week could save ~\u20C3 1,000/month.`,pill:'💡 Actionable',pillColor:'#f5c842' },
    { icon:'💻',color:'#60a5fa',title:`\u20C3 ${subscTotal.toFixed(0)} in tech subscriptions — audit needed`,body:`Apple services alone billed across multiple charges. Check for duplicate family plan charges or unused apps. A full audit could recover \u20C3 300–500/month.`,pill:'⚠️ Audit Now',pillColor:'#ff6b6b' },
    { icon:'📈',color:'#ff6b6b',title:`${maxMonthName} was your highest spend month — \u20C3 ${maxMonthVal.toFixed(0)}`,body:`Your spending varies significantly month to month. Track monthly totals regularly to distinguish one-off spikes from structural overspending.`,pill:'📊 Context',pillColor:'#7b8ff5' },
    { icon:'💊',color:'#f472b6',title:`Mayfair Clinic: \u20C3 ${(merchantTotals['MAYFAIR CLINIC']||0).toFixed(0)} — Mounjaro costs`,body:`Recurring charges of \u20C3 1,499 suggest a monthly Mounjaro prescription. An intentional health investment. Verify whether your Four Seasons role includes healthcare benefits.`,pill:'✅ Keep Going',pillColor:'#00e5a0' },
    { icon:'🏠',color:'#f5c842',title:`Net cash flow: ${net>=0?'+':''}\u20C3 ${Math.abs(net).toFixed(0)}`,body:`Over ${days} days you received \u20C3 ${totalReceived.toFixed(0)} and spent \u20C3 ${totalSpend.toFixed(0)}. With a housing allowance covering rent, consistent savings of \u20C3 5,000–8,000/month toward a 1.5M property target is realistic.`,pill:'🏡 On Track',pillColor:'#00e5a0' },
    { icon:'🛍️',color:'#fbbf24',title:`Shopping hit \u20C3 ${(catTotals['Shopping']||0).toFixed(0)} — mostly impulse channels`,body:`Temu, Namshi, Amazon.ae, and Adidas spread across the period. Consider a monthly shopping cap of \u20C3 800 and a 24-hour rule before confirming orders.`,pill:'💡 Set a Cap',pillColor:'#f5c842' },
    { icon:'💳',color:'#6b7280',title:`TABBY repayments: \u20C3 ${(merchantTotals['TABBY']||0).toFixed(0)} across multiple charges`,body:`Active BNPL installment plan. TABBY spending is invisible in real-time budgeting — ensure you're accounting for upcoming installments in your monthly outgoings.`,pill:'🔔 Track It',pillColor:'#6b7280' },
  ]
}

// ─── SMALL COMPONENTS ────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize:10,letterSpacing:'0.2em',textTransform:'uppercase' as const,color:'var(--muted)',marginBottom:16,fontWeight:500,display:'flex',alignItems:'center',gap:10 }}>
      {children}<div style={{ flex:1,height:1,background:'var(--border)' }}/>
    </div>
  )
}

function KPICard({ label, value, sub, color }: { label:string; value:React.ReactNode; sub:React.ReactNode; color:string }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardLabel}>{label}</div>
      <div style={{ ...styles.cardValue, color }}>{value}</div>
      <div style={styles.cardSub}>{sub}</div>
    </div>
  )
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  header: { position:'sticky',top:0,zIndex:100,background:'var(--header-bg)',backdropFilter:'blur(20px)',borderBottom:'1px solid var(--border)',padding:'12px 32px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12 },
  tab: { padding:'10px 16px',borderRadius:0,cursor:'pointer',fontSize:12,fontWeight:500,color:'var(--muted)',border:'none',background:'none',letterSpacing:'0.02em',borderBottom:'2px solid transparent',transition:'all 0.2s' },
  tabActive: { color:'var(--text)',borderBottom:'2px solid var(--accent)' },
  uploadBtn: { display:'flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:8,cursor:'pointer',background:'rgba(0,229,160,0.07)',border:'1px solid rgba(0,229,160,0.2)',color:'var(--accent)',fontSize:12,fontWeight:500 },
  signOutBtn: { padding:'7px 12px',borderRadius:8,cursor:'pointer',background:'none',border:'1px solid var(--border)',color:'var(--muted)',fontSize:12 },
  themeToggle: { width:36,height:20,borderRadius:10,border:'1px solid var(--border)',background:'var(--surface2)',cursor:'pointer',position:'relative',flexShrink:0,outline:'none' },
  themeKnob: { position:'absolute',top:2,left:2,width:14,height:14,borderRadius:'50%',transition:'transform 0.3s, background 0.3s',display:'block' },
  dataBadge: { display:'inline-flex',alignItems:'center',gap:4,fontSize:9,letterSpacing:'0.08em',padding:'3px 8px',borderRadius:8,background:'rgba(0,229,160,0.06)',border:'1px solid rgba(0,229,160,0.15)',color:'var(--muted)',marginLeft:6 },
  card: { background:'var(--surface)',border:'1px solid var(--border)',borderRadius:16,padding:24,position:'relative',overflow:'hidden' },
  cardLabel: { fontSize:10,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--muted)',marginBottom:10,fontWeight:500 },
  cardValue: { fontSize:28,fontWeight:700,lineHeight:1,letterSpacing:'-0.5px' },
  cardSub: { fontSize:11,color:'var(--muted)',marginTop:6 },
  grid2: { display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:20 },
  grid4: { display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:20,marginBottom:20 },
  gridAuto: { display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))',gap:16,marginBottom:20 },
  dropOverlay: { position:'fixed',inset:0,zIndex:999,background:'rgba(10,10,15,0.92)',backdropFilter:'blur(8px)',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16 },
  dropBox: { border:'2px dashed var(--accent)',borderRadius:20,padding:'60px 80px',textAlign:'center' },
  toast: { position:'fixed',bottom:32,right:32,zIndex:1000,background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 18px',display:'flex',alignItems:'flex-start',gap:12,boxShadow:'0 8px 32px rgba(0,0,0,0.4)',maxWidth:340 },
  filterBtn: { padding:'5px 12px',borderRadius:20,cursor:'pointer',fontSize:10,fontWeight:500,color:'var(--muted)',border:'1px solid var(--border)',background:'none',letterSpacing:'0.05em' },
  filterBtnActive: { color:'var(--text)',borderColor:'var(--accent)',background:'rgba(0,229,160,0.05)' },
  searchInput: { background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,padding:'6px 10px',color:'var(--text)',fontSize:12,outline:'none' },
  th: { padding:'10px 12px',fontSize:10,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--muted)',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap',userSelect:'none' },
  td: { padding:'10px 12px',fontSize:12,borderBottom:'1px solid var(--border)' },
  insightCard: { display:'flex',gap:14,padding:20,background:'var(--surface2)',borderRadius:12,border:'1px solid var(--border)',borderLeft:'3px solid transparent' },
  pageBtn: { padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)',background:'none',cursor:'pointer',color:'var(--muted)',fontSize:12 },
}
