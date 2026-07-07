/**
 * Root.jsx
 *
 * - Auth gate
 * - Injects window.storage shim (user-scoped)
 * - Clears other users' cached data from localStorage on login
 * - Seeds owner data from ownerSeed.json on first login
 */

import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { loadData, saveData, clearOtherUsersCache } from './storage'
import LoginPage from './LoginPage'
import App from './App'
import { supabase } from './supabase'

export default function Root() {
  const { user, loading } = useAuth()
  const [seeding, setSeeding] = useState(false)

  // Tracks which userId (or null for signed-out) window.storage is
  // currently configured for. Read directly during render -- not via a
  // state value that only updates a render cycle later -- so App can
  // never mount before window.storage actually matches the current user.
  const configuredForRef = useRef('__unset__')
  const currentUserId = user?.id ?? null
  const storageReadyForCurrentUser = !loading && configuredForRef.current === currentUserId
  const [, forceRerender] = useState(0)

  // Inject window.storage shim, scoped to the current user
  useEffect(() => {
    if (loading) return
    const userId = user?.id ?? null

    // Clear any other user's cached data from localStorage on this device
    if (userId) clearOtherUsersCache(userId)

    window.storage = {
      async get(key) {
        const result = await loadData(userId)
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
        await saveData(userId, parsed)
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

  // On first login by the owner, seed personal data from ownerSeed.json
  useEffect(() => {
    if (!user || !supabase || !storageReadyForCurrentUser) return
    const ownerEmail = import.meta.env.VITE_OWNER_EMAIL
    if (!ownerEmail || user.email !== ownerEmail) return

    ;(async () => {
      const existing = await loadData(user.id)
      if (existing.status === 'error') return // don't touch anything on a failed load
      if (existing.data && existing.data.snapshots && existing.data.snapshots.length > 0) return
      try {
        const res = await fetch('/ownerSeed.json')
        if (!res.ok) return
        const seed = await res.json()
        if (!seed || !seed.snapshots) return
        setSeeding(true)
        await saveData(user.id, seed)
        window.location.reload()
      } catch (e) {
        console.warn('Owner seed import failed:', e.message)
        setSeeding(false)
      }
    })()
  }, [user, storageReadyForCurrentUser])

  if (loading || !storageReadyForCurrentUser || seeding) {
    return (
      <div style={{ minHeight: '100vh', background: '#fbf8f4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', color: '#8a8178', fontSize: 14, gap: 12 }}>
        <div>{seeding ? 'Importing your data…' : 'Loading…'}</div>
        {seeding && <div style={{ fontSize: 12 }}>This only happens once on first login.</div>}
      </div>
    )
  }

  if (supabase && !user) return <LoginPage />

  // key forces a full unmount/remount of App whenever the logged-in
  // user changes, so no in-memory state (snapshots, transactions,
  // budgets, etc.) can leak from one account's session into another's.
  return <App key={user?.id ?? 'anon'} />
}
