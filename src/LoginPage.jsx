import React, { useState } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from './supabase'

const ACCENT = '#c97c5d'
const INK = '#2b2620'
const MUTED = '#8a8178'
const BORDER = '#e8e2d8'
const BG = '#fbf8f4'

export default function LoginPage() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth()
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      if (mode === 'signup') {
        const { error } = await signUpWithEmail(email, password)
        if (error) throw error
        setSuccess('Check your email for a confirmation link.')
      } else {
        const { error } = await signInWithEmail(email, password)
        if (error) throw error
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', system-ui, sans-serif", padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo / heading */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
          <h1 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: 28, fontWeight: 700, color: INK, margin: 0 }}>
            Finance Tracker
          </h1>
          <p style={{ color: MUTED, fontSize: 14, marginTop: 8 }}>
            Your personal net worth & cash flow dashboard
          </p>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: `1px solid ${BORDER}`, padding: 32, boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>

          {/* Google sign-in */}
          {supabase && (
            <>
              <button
                onClick={signInWithGoogle}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 16px', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: INK, marginBottom: 20 }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.174 0 7.548 0 9s.348 2.826.957 4.039l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
                Continue with Google
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <div style={{ flex: 1, height: 1, background: BORDER }} />
                <span style={{ fontSize: 12, color: MUTED }}>or</span>
                <div style={{ flex: 1, height: 1, background: BORDER }} />
              </div>
            </>
          )}

          {/* Email form */}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Email</label>
              <input
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 14, color: INK, background: BG, boxSizing: 'border-box' }}
                placeholder="you@example.com"
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Password</label>
              <input
                type="password" required value={password} onChange={e => setPassword(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 14, color: INK, background: BG, boxSizing: 'border-box' }}
                placeholder="••••••••"
              />
            </div>

            {error && <div style={{ background: '#fdf0ef', border: '1px solid #e8c4c0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#8b3a35', marginBottom: 14 }}>{error}</div>}
            {success && <div style={{ background: '#f0f6f1', border: '1px solid #c4dac9', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#3a6b4a', marginBottom: 14 }}>{success}</div>}

            <button
              type="submit" disabled={loading}
              style={{ width: '100%', padding: '12px', background: ACCENT, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? '…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 13, color: MUTED, marginTop: 20, marginBottom: 0 }}>
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setSuccess(null); }} style={{ background: 'none', border: 'none', color: ACCENT, fontWeight: 600, cursor: 'pointer', fontSize: 13, padding: 0 }}>
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: MUTED, marginTop: 24 }}>
          Your financial data is encrypted and stored securely.<br />
          We never sell or share your data.
        </p>
      </div>
    </div>
  )
}
