/**
 * Root.jsx
 *
 * Handles:
 *  - Auth gate: show LoginPage if Supabase is configured and user not logged in
 *  - Injects the storage abstraction into window.storage so App.jsx works
 *    unchanged whether Supabase is configured or not
 *  - Passes userId to the storage layer for per-user data isolation
 */

import React, { useEffect } from 'react'
import { useAuth } from './AuthContext'
import { loadData, saveData } from './storage'
import LoginPage from './LoginPage'
import App from './App'
import { supabase } from './supabase'

export default function Root() {
  const { user, loading } = useAuth()

  // Inject window.storage shim that the App component uses internally.
  // This replaces the Claude artifact window.storage API with our own.
  useEffect(() => {
    const userId = user?.id ?? null

    window.storage = {
      async get(key) {
        const data = await loadData(userId)
        if (!data) return null
        return { key, value: typeof data === 'string' ? data : JSON.stringify(data) }
      },
      async set(key, value) {
        const parsed = (() => {
          try { return JSON.parse(value) } catch { return value }
        })()
        await saveData(userId, parsed)
        return { key, value }
      },
      async delete(key) {
        return { key, deleted: true }
      },
      async list() {
        return { keys: [] }
      },
    }
  }, [user])

  // Still booting — don't flash anything
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#fbf8f4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', color: '#8a8178', fontSize: 14 }}>
        Loading…
      </div>
    )
  }

  // If Supabase is configured, require login
  if (supabase && !user) {
    return <LoginPage />
  }

  // No Supabase configured → run as anonymous single-user app (original behaviour)
  return <App />
}
