import React, { useState } from 'react'
import { useAuth } from './AuthContext'
import { verifyKey } from './storage'

const ACCENT = '#c97c5d'
const INK = '#2b2620'
const MUTED = '#8a8178'
const BORDER = '#e8e2d8'
const BG = '#fbf8f4'

export default function UnlockGate() {
  const { user, deriveCandidateKey, setEncryptionKey, signOut } = useAuth()
  const isPasswordAccount = user?.app_metadata?.providers?.includes('email')
    ?? user?.app_metadata?.provider === 'email'
  const hasSaltAlready = !!user?.user_metadata?.enc_salt
  // Password accounts always just re-enter their login password. OAuth
  // accounts (no password) set a separate data passphrase the first time,
  // then re-enter that same passphrase on every later unlock.
  const isFirstTimePassphrase = !isPasswordAccount && !hasSaltAlready

  const [secret, setSecret] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (isFirstTimePassphrase) {
      if (secret.length < 8) { setError('Use at least 8 characters.'); return }
      if (secret !== confirm) { setError("Passphrases don't match."); return }
    }
    setLoading(true)
    try {
      const key = await deriveCandidateKey(secret)
      const ok = await verifyKey(user.id, key)
      if (!ok) {
        setError(isPasswordAccount
          ? "That didn't unlock your data. Try your password again."
          : "That passphrase didn't unlock your data. Try again.")
        setLoading(false)
        return
      }
      setEncryptionKey(key)
    } catch (err) {
      setError(err.message || 'Something went wrong — try again.')
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', system-ui, sans-serif", padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🔒</div>
          <h1 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: 22, fontWeight: 700, color: INK, margin: 0 }}>
            {isFirstTimePassphrase ? 'Create a data passphrase' : 'Unlock your data'}
          </h1>
          <p style={{ color: MUTED, fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
            {isPasswordAccount
              ? 'Your financial data is encrypted. Enter your account password to unlock it for this session.'
              : isFirstTimePassphrase
              ? "Since you signed in with Google, there's no password to derive an encryption key from. Choose a separate passphrase just for this — it encrypts your financial data before it ever leaves your browser."
              : 'Enter your data passphrase to unlock your encrypted financial data for this session.'}
          </p>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: `1px solid ${BORDER}`, padding: 28, boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
          {isFirstTimePassphrase && (
            <div style={{ background: '#fdf6ec', border: '1px solid #e6d3ac', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#8a6d23', marginBottom: 16, lineHeight: 1.5 }}>
              ⚠️ There is no "forgot passphrase" recovery — that's what makes it actually protect your data. Store it in a password manager. If it's lost, your encrypted data cannot be recovered by you or anyone else, including support.
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: isFirstTimePassphrase ? 14 : 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {isPasswordAccount ? 'Password' : 'Data passphrase'}
              </label>
              <input
                type="password"
                autoFocus
                required
                value={secret}
                onChange={e => setSecret(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 14, color: INK, background: BG, boxSizing: 'border-box' }}
                placeholder="••••••••"
              />
            </div>
            {isFirstTimePassphrase && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Confirm passphrase</label>
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 14, color: INK, background: BG, boxSizing: 'border-box' }}
                  placeholder="••••••••"
                />
              </div>
            )}
            {error && <div style={{ background: '#fdf0ef', border: '1px solid #e8c4c0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#8b3a35', marginBottom: 14 }}>{error}</div>}
            <button type="submit" disabled={loading}
              style={{ width: '100%', padding: '12px', background: ACCENT, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? '…' : isFirstTimePassphrase ? 'Set passphrase & continue' : 'Unlock'}
            </button>
          </form>
          <button onClick={signOut} style={{ width: '100%', marginTop: 16, background: 'none', border: 'none', color: MUTED, fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
