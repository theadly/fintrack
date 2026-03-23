'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0f', display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Mono', monospace"
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@800&family=DM+Mono:wght@400;500&display=swap')`}</style>
      <div style={{ width: '100%', maxWidth: 400, padding: '0 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, letterSpacing: -1, color: '#e8e8f0' }}>
            ADLY / <span style={{ color: '#00e5a0' }}>FINTRACK</span>
          </div>
          <div style={{ fontSize: 11, color: '#6b6b85', marginTop: 8, letterSpacing: '0.1em' }}>PERSONAL FINANCE DASHBOARD</div>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#6b6b85', display: 'block', marginBottom: 6 }}>Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              style={{ width: '100%', background: '#111118', border: '1px solid #2a2a38', borderRadius: 8, padding: '10px 14px', color: '#e8e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#6b6b85', display: 'block', marginBottom: 6 }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              style={{ width: '100%', background: '#111118', border: '1px solid #2a2a38', borderRadius: 8, padding: '10px 14px', color: '#e8e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {error && (
            <div style={{ background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.25)', borderRadius: 8, padding: '10px 14px', color: '#ff6b6b', fontSize: 11 }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            style={{ background: loading ? 'rgba(0,229,160,0.05)' : 'rgba(0,229,160,0.1)', border: '1px solid rgba(0,229,160,0.3)', borderRadius: 8, padding: '12px', color: '#00e5a0', fontSize: 12, fontFamily: 'inherit', fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.05em' }}
          >
            {loading ? 'Signing in...' : 'Sign In →'}
          </button>
        </form>
      </div>
    </div>
  )
}
