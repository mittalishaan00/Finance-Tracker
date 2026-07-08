import React, { useEffect, useState } from 'react'
import { useAuth } from './AuthContext'

const ACCENT = '#c97c5d'
const INK = '#2b2620'
const MUTED = '#8a8178'
const BORDER = '#e8e2d8'
const BG = '#fbf8f4'

export default function MfaChallengeGate() {
  const { mfaListFactors, mfaChallengeAndVerify, signOut } = useAuth()
  const [factorId, setFactorId] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingFactors, setLoadingFactors] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const data = await mfaListFactors()
        const verified = data?.totp?.find(f => f.status === 'verified') || data?.all?.find(f => f.status === 'verified')
        setFactorId(verified?.id ?? null)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoadingFactors(false)
      }
    })()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!factorId) return
    setError(null)
    setLoading(true)
    try {
      await mfaChallengeAndVerify(factorId, code.trim())
    } catch (err) {
      setError(err.message || 'Invalid code — try again')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', system-ui, sans-serif", padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🔐</div>
          <h1 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: 22, fontWeight: 700, color: INK, margin: 0 }}>Two-factor verification</h1>
          <p style={{ color: MUTED, fontSize: 13, marginTop: 8 }}>Enter the 6-digit code from your authenticator app.</p>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: `1px solid ${BORDER}`, padding: 28, boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
          {loadingFactors ? (
            <div style={{ fontSize: 13, color: MUTED, textAlign: 'center' }}>Loading…</div>
          ) : !factorId ? (
            <div style={{ fontSize: 13, color: '#8b3a35' }}>Couldn't find your verified authenticator. Try signing in again, or contact support.</div>
          ) : (
            <form onSubmit={handleSubmit}>
              <input
                autoFocus
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                style={{ width: '100%', padding: '12px 14px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 22, letterSpacing: '0.3em', textAlign: 'center', color: INK, background: BG, boxSizing: 'border-box', marginBottom: 14, fontFamily: "'JetBrains Mono', monospace" }}
              />
              {error && <div style={{ background: '#fdf0ef', border: '1px solid #e8c4c0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#8b3a35', marginBottom: 14 }}>{error}</div>}
              <button type="submit" disabled={loading || code.length < 6}
                style={{ width: '100%', padding: '12px', background: ACCENT, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: (loading || code.length < 6) ? 0.6 : 1 }}>
                {loading ? 'Verifying…' : 'Verify'}
              </button>
            </form>
          )}
          <button onClick={signOut} style={{ width: '100%', marginTop: 16, background: 'none', border: 'none', color: MUTED, fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
