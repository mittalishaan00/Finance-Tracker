import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { generateSalt, deriveKey } from './crypto'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined)
  const [loading, setLoading] = useState(true)
  // In-memory only, never persisted -- see crypto.js for why.
  const [encryptionKey, setEncryptionKeyState] = useState(null)
  // Mirrors encryptionKey, but updated synchronously (not via a useEffect)
  // the instant setEncryptionKey is called -- see the long comment on
  // setEncryptionKey below for why this matters.
  const encryptionKeyRef = useRef(null)
  // 'aal1' | 'aal2' | null -- Supabase's current authenticator assurance
  // level. A user with a verified MFA factor sits at aal1 until they pass
  // a challenge, then aal2 for the rest of the session.
  const [aal, setAal] = useState(null)

  useEffect(() => {
    if (!supabase) {
      setUser(null)
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    refreshAal()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      refreshAal()
    })
    return () => subscription.unsubscribe()
  }, [])

  async function refreshAal() {
    if (!supabase) return
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (!error) setAal(data ? { currentLevel: data.currentLevel, nextLevel: data.nextLevel } : null)
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  async function signInWithEmail(email, password) {
    return supabase.auth.signInWithPassword({ email, password })
  }

  async function signUpWithEmail(email, password) {
    return supabase.auth.signUp({ email, password })
  }

  async function signOut() {
    // Also drop the injected storage shim and the in-memory encryption
    // key immediately so nothing in the current tab can read/write the
    // outgoing user's data before the next login's Root effect re-injects
    // a freshly-scoped shim.
    if (typeof window !== 'undefined') {
      window.storage = undefined
    }
    encryptionKeyRef.current = null
    setEncryptionKeyState(null)
    setAal(null)
    await supabase?.auth.signOut()
  }

  // ---- Encryption key management ----
  // The salt itself isn't secret (it just makes the key derivation unique
  // per account) so it's fine to store in Supabase auth user_metadata,
  // which the user's own session can already read/write.
  async function getOrCreateSalt() {
    const { data } = await supabase.auth.getUser()
    const existing = data?.user?.user_metadata?.enc_salt
    if (existing) return existing
    const salt = generateSalt()
    await supabase.auth.updateUser({ data: { enc_salt: salt } })
    return salt
  }

  // Derives a key from a password/passphrase but does NOT commit it as
  // the active session key -- callers should verify it opens the user's
  // actual data (see storage.js: verifyKey) before calling setEncryptionKey.
  async function deriveCandidateKey(secret) {
    const salt = await getOrCreateSalt()
    return deriveKey(secret, salt)
  }

  // THE FIX: this updates encryptionKeyRef.current synchronously, in the
  // same function call that also updates React state -- not in a
  // useEffect keyed on encryptionKey (which is what Root.jsx used to do).
  // That distinction is the whole bug: an effect only runs *after* a
  // render commits, and React runs a child component's effects before
  // its parent's effects within that same commit. The moment
  // encryptionKey flips from null to a real key, Root re-renders and, in
  // that SAME commit, swaps <UnlockGate/> out for <App/>. App (the
  // child) immediately tries to load data, reading whatever the ref
  // holds right now -- but Root's own "sync the ref" effect (the
  // parent's effect) hasn't run yet, so the ref was still null. Since
  // real encrypted data exists in Supabase by the time this matters, the
  // load fails outright instead of just being "empty" -- exactly the
  // "Couldn't load your data" screen. Setting the ref here, as a plain
  // synchronous assignment, means it's already correct before React even
  // starts that render -- there's no window for the race to occur in.
  function setEncryptionKey(key) {
    encryptionKeyRef.current = key
    setEncryptionKeyState(key)
  }

  async function updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
  }

  // ---- MFA (TOTP) ----
  async function mfaListFactors() {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) throw error
    return data
  }

  async function mfaEnroll() {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    if (error) throw error
    return data // { id, totp: { qr_code, secret, uri } }
  }

  async function mfaVerifyEnrollment(factorId, code) {
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError) throw challengeError
    const { data, error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code })
    if (error) throw error
    await refreshAal()
    return data
  }

  async function mfaUnenroll(factorId) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) throw error
    await refreshAal()
  }

  async function mfaChallengeAndVerify(factorId, code) {
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError) throw challengeError
    const { data, error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code })
    if (error) throw error
    await refreshAal()
    return data
  }

  return (
    <AuthContext.Provider value={{
      user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut,
      encryptionKey, encryptionKeyRef, setEncryptionKey, deriveCandidateKey, updatePassword,
      aal, refreshAal,
      mfaListFactors, mfaEnroll, mfaVerifyEnrollment, mfaUnenroll, mfaChallengeAndVerify,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
