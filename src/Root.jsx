/**
 * Root.jsx
 *
 * Gating order for a signed-in user:
 *   1. Auth (LoginPage) — not signed in at all
 *   2. MFA challenge (MfaChallengeGate) — signed in, but has a verified
 *      TOTP factor and hasn't passed a challenge this session (aal1 -> aal2)
 *   3. Unlock (UnlockGate) — signed in (and past MFA if applicable), but
 *      the in-memory encryption key for this session hasn't been
 *      derived/verified yet (e.g. right after a page refresh)
 *   4. App
 *
 * Also injects window.storage (user- and key-scoped) and clears other
 * users' cached data from localStorage on login.
 */

import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { loadData, saveData, clearOtherUsersCache } from './storage'
import LoginPage from './LoginPage'
import MfaChallengeGate from './MfaChallengeGate'
import UnlockGate from './UnlockGate'
import App from './App'
import { supabase } from './supabase'

export default function Root() {
  const { user, loading, aal, encryptionKey, encryptionKeyRef } = useAuth()

  // Tracks which userId (or null for signed-out) window.storage is
  // currently configured for. Read directly during render -- not via a
  // state value that only updates a render cycle later -- so App can
  // never mount before window.storage actually matches the current user.
  const configuredForRef = useRef('__unset__')
  const currentUserId = user?.id ?? null
  const storageReadyForCurrentUser = !loading && configuredForRef.current === currentUserId
  const [, forceRerender] = useState(0)

  // NOTE: encryptionKeyRef comes from AuthContext, not a local ref kept
  // in sync via useEffect here. That used to be the bug: an effect-based
  // sync runs one render late relative to App's own mount effect (see
  // the comment on AuthContext's setEncryptionKey for the full
  // explanation). Reading the context's ref directly means it's already
  // correct by the time App asks for it, no matter how the two
  // components' effects get ordered.

  // Inject window.storage shim, scoped to the current user
  useEffect(() => {
    if (loading) return
    const userId = user?.id ?? null

    // Clear any other user's cached data from localStorage on this device
    if (userId) clearOtherUsersCache(userId)

    window.storage = {
      async get(key) {
        const result = await loadData(userId, encryptionKeyRef.current)
        return {
          key,
          value: result.data ? JSON.stringify(result.data) : null,
          status: result.status, // 'ok' | 'empty' | 'error'
        }
      },
      async set(key, value) {
        const parsed = (() => {
          try { return JSON.parse(value) } catch { return value }
        })()
        await saveData(userId, parsed, encryptionKeyRef.current)
        return { key, value }
      },
      async delete(key) { return { key, deleted: true } },
      async list() { return { keys: [] } },
    }

    // Mark this userId as configured, then force one re-render. On that
    // re-render, storageReadyForCurrentUser reads as true for the first
    // time -- guaranteeing window.storage was set in an earlier commit,
    // never the same one that mounts App.
    configuredForRef.current = userId
    forceRerender(n => n + 1)
  }, [user, loading])

  if (loading || !storageReadyForCurrentUser) {
    return (
      <div style={{ minHeight: '100vh', background: '#fbf8f4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', color: '#8a8178', fontSize: 14, gap: 12 }}>
        <div>Loading…</div>
      </div>
    )
  }

  if (supabase && !user) return <LoginPage />

  const mfaPending = aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2'
  if (supabase && user && mfaPending) return <MfaChallengeGate />

  if (supabase && user && !encryptionKey) return <UnlockGate />

  // key forces a full unmount/remount of App whenever the logged-in
  // user changes, so no in-memory state (snapshots, transactions,
  // budgets, etc.) can leak from one account's session into another's.
  return <App key={user?.id ?? 'anon'} />
}
