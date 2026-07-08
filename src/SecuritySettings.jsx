import React, { useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { reencryptData } from './storage'

const ACCENT = '#c97c5d'
const INK = '#2b2620'
const MUTED = '#8a8178'
const BORDER = '#e8e2d8'

function ChangeSecretSection() {
  const { user, encryptionKey, setEncryptionKey, deriveCandidateKey, updatePassword } = useAuth()
  const isPasswordAccount = user?.app_metadata?.providers?.includes('email')
    ?? user?.app_metadata?.provider === 'email'

  const [newSecret, setNewSecret] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  // Set once Supabase's password has already been changed, so a failed
  // re-encrypt attempt can be retried without calling updateUser again.
  const [passwordAlreadyChanged, setPasswordAlreadyChanged] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!encryptionKey) {
      setError('Your data needs to be unlocked before you can do this — reload the page and unlock first.')
      return
    }
    if (newSecret.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (newSecret !== confirm) {
      setError("Those don't match.")
      return
    }
    setBusy(true)
    try {
      // Order matters: for password accounts, change the Supabase Auth
      // password first. If THAT fails (weak password, network issue),
      // nothing else has happened yet, so it's safe to just show the
      // error and let the user retry from scratch.
      //
      // If it succeeds but the re-encrypt step below then fails, we
      // deliberately do NOT touch `encryptionKey` in context -- the app
      // keeps working normally for the rest of this session using the
      // OLD key, because the stored row is still encrypted under it.
      // The new Supabase password is already live, so the next fresh
      // unlock (new tab, refresh, next login) would derive a
      // *different* key than what's actually protecting the data and
      // fail to open it -- which is exactly why we show a "Finish
      // re-encrypting" retry button instead of quietly losing that
      // state if the user navigates away.
      if (isPasswordAccount && !passwordAlreadyChanged) {
        await updatePassword(newSecret)
        setPasswordAlreadyChanged(true)
      }

      const newKey = await deriveCandidateKey(newSecret) // reuses this account's existing salt
      const result = await reencryptData(user.id, encryptionKey, newKey)
      if (!result.ok) {
        throw result.error || new Error('Re-encrypting your data failed.')
      }

      setEncryptionKey(newKey)
      setPasswordAlreadyChanged(false)
      setNewSecret('')
      setConfirm('')
      setSuccess(isPasswordAccount
        ? 'Password changed, and your data has been re-encrypted with it.'
        : 'Passphrase changed, and your data has been re-encrypted with it.')
    } catch (err) {
      setError(
        (passwordAlreadyChanged
          ? 'Your password was changed, but re-encrypting your existing data failed. Your data is still safe and accessible (this session only) — click below to finish re-encrypting it. Don\'t close this tab until it succeeds, or you\'ll need your new password and a fresh copy of this app to recover.'
          : null) || err.message || 'Something went wrong.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel" style={{ padding: 20, maxWidth: 520, marginTop: 16 }}>
      <div style={{ fontFamily: "'Source Serif 4', serif", fontSize: 20, fontWeight: 700, color: INK, marginBottom: 4 }}>
        {isPasswordAccount ? 'Change password' : 'Change data passphrase'}
      </div>
      <p style={{ fontSize: 13, color: MUTED, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
        {isPasswordAccount
          ? 'Your financial data is encrypted with a key derived from this password. Changing it here re-encrypts your existing data automatically, so nothing gets locked out.'
          : "Your financial data is encrypted with a key derived from this passphrase (separate from your Google sign-in). Changing it here re-encrypts your existing data automatically."}
      </p>

      {error && <div style={{ background: '#fdf0ef', border: '1px solid #e8c4c0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#8b3a35', marginBottom: 14, lineHeight: 1.5 }}>{error}</div>}
      {success && <div style={{ background: '#f0f6f1', border: '1px solid #c4dac9', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#3a6b4a', marginBottom: 14 }}>{success}</div>}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {isPasswordAccount ? 'New password' : 'New passphrase'}
          </label>
          <input type="password" value={newSecret} onChange={e => setNewSecret(e.target.value)}
            style={{ width: '100%', maxWidth: 320, padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 14, color: INK, boxSizing: 'border-box' }}
            placeholder="••••••••" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Confirm</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            style={{ width: '100%', maxWidth: 320, padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 14, color: INK, boxSizing: 'border-box' }}
            placeholder="••••••••" />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? '…' : passwordAlreadyChanged ? 'Finish re-encrypting' : isPasswordAccount ? 'Change password' : 'Change passphrase'}
        </button>
      </form>
    </div>
  )
}

function MfaPanel() {
  const { mfaListFactors, mfaEnroll, mfaVerifyEnrollment, mfaUnenroll } = useAuth()
  const [factors, setFactors] = useState(null)
  const [enrolling, setEnrolling] = useState(null) // { id, qrCode, secret }
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [justEnabled, setJustEnabled] = useState(false)

  async function refresh() {
    try {
      const data = await mfaListFactors()
      setFactors((data?.totp || data?.all || []).filter(f => f.status === 'verified'))
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { refresh() }, [])

  async function startEnroll() {
    setError(null)
    setBusy(true)
    try {
      const data = await mfaEnroll()
      setEnrolling({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmEnroll(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await mfaVerifyEnrollment(enrolling.id, code.trim())
      setEnrolling(null)
      setCode('')
      setJustEnabled(true)
      await refresh()
    } catch (e) {
      setError(e.message || 'Invalid code — try again')
    } finally {
      setBusy(false)
    }
  }

  async function removeFactor(id) {
    if (!confirm('Remove two-factor authentication? Anyone with your password alone will then be able to sign in.')) return
    setError(null)
    setBusy(true)
    try {
      await mfaUnenroll(id)
      await refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel" style={{ padding: 20, maxWidth: 520 }}>
      <div style={{ fontFamily: "'Source Serif 4', serif", fontSize: 20, fontWeight: 700, color: INK, marginBottom: 4 }}>Two-factor authentication</div>
      <p style={{ fontSize: 13, color: MUTED, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
        Adds a second step at login (a 6-digit code from an authenticator app like Google Authenticator or 1Password) so a leaked or guessed password alone isn't enough to get into your account.
      </p>

      {error && <div style={{ background: '#fdf0ef', border: '1px solid #e8c4c0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#8b3a35', marginBottom: 14 }}>{error}</div>}
      {justEnabled && <div style={{ background: '#f0f6f1', border: '1px solid #c4dac9', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#3a6b4a', marginBottom: 14 }}>Two-factor authentication is now on. You'll be asked for a code next time you sign in.</div>}

      {!enrolling && factors && factors.length === 0 && (
        <button className="btn-primary" onClick={startEnroll} disabled={busy}>Set up two-factor authentication</button>
      )}

      {!enrolling && factors && factors.length > 0 && (
        <div>
          {factors.map(f => (
            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13 }}>
              <span>✅ Authenticator app enabled{f.friendly_name ? ` (${f.friendly_name})` : ''}</span>
              <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => removeFactor(f.id)} disabled={busy}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {enrolling && (
        <form onSubmit={confirmEnroll}>
          <p style={{ fontSize: 13, color: INK, marginBottom: 10 }}>Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
          <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, marginBottom: 10, display: 'inline-block' }}>
            <img src={enrolling.qrCode} alt="TOTP QR code" width={180} height={180} />
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
            Can't scan it? Enter this key manually: <code style={{ background: '#f3eee6', padding: '2px 6px', borderRadius: 4 }}>{enrolling.secret}</code>
          </div>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            style={{ width: 160, padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 18, letterSpacing: '0.2em', textAlign: 'center', color: INK, marginBottom: 12, display: 'block', fontFamily: "'JetBrains Mono', monospace" }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn-primary" disabled={busy || code.length < 6}>Confirm & enable</button>
            <button type="button" className="btn-ghost" onClick={() => { setEnrolling(null); setCode(''); setError(null) }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}

export default function SecuritySettings() {
  return (
    <div>
      <MfaPanel />
      <ChangeSecretSection />
    </div>
  )
}
