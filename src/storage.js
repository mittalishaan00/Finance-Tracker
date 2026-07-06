/**
 * storage.js
 *
 * localStorage keys are scoped to userId so multiple users
 * on the same device never see each other's data.
 */
import { supabase } from './supabase'

function localKey(userId) {
  return userId ? `finance-tracker-${userId}` : 'finance-tracker-anon'
}

// Marks that this browser has, at some point, successfully loaded real
// (non-empty) data for this user. Once set, a later "zero rows" response
// is treated as suspicious (likely an auth/session race) rather than
// "genuinely empty" -- so it can never again be silently autosaved over.
function hasDataFlagKey(userId) {
  return `finance-tracker-hasdata-${userId}`
}

function looksNonEmpty(payload) {
  if (!payload) return false
  const nonEmptyArray = (a) => Array.isArray(a) && a.length > 0
  const nonEmptyObj = (o) => o && typeof o === 'object' && Object.keys(o).length > 0
  return nonEmptyArray(payload.snapshots) || nonEmptyArray(payload.transactions) ||
    nonEmptyArray(payload.categories) || nonEmptyObj(payload.costBasis) || nonEmptyObj(payload.classMap)
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)) }

export function clearOtherUsersCache(currentUserId) {
  const keep = localKey(currentUserId)
  Object.keys(localStorage)
    .filter(k => k.startsWith('finance-tracker-') && k !== keep && !k.startsWith('finance-tracker-hasdata-'))
    .forEach(k => localStorage.removeItem(k))
}

async function fetchRow(userId) {
  return supabase
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .single()
}

export async function loadData(userId) {
  const key = localKey(userId)
  const knownNonEmpty = userId ? localStorage.getItem(hasDataFlagKey(userId)) === '1' : false

  if (supabase && userId) {
    // Make sure the client actually has a session matching this user
    // before querying -- avoids the common race where the select fires
    // a beat before the just-completed sign-in's token is attached,
    // which RLS then silently reports as "zero rows" instead of an error.
    for (let i = 0; i < 5; i++) {
      const { data: sessionData } = await supabase.auth.getSession()
      if (sessionData?.session?.user?.id === userId) break
      await sleep(150)
    }

    let lastError = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data, error } = await fetchRow(userId)

        if (!error && data?.data) {
          localStorage.setItem(key, JSON.stringify(data.data))
          if (looksNonEmpty(data.data)) localStorage.setItem(hasDataFlagKey(userId), '1')
          return { status: 'ok', data: data.data }
        }

        if (error && error.code === 'PGRST116') {
          // Zero rows. If we've never confirmed this account had real
          // data, this is plausibly a genuinely new account -- but
          // retry briefly first in case it's just the session race.
          if (attempt < 2) { await sleep(250); continue }
          if (knownNonEmpty) {
            // We know this account has real data -- zero rows now is a
            // failure, not a fresh account. Never treat it as empty.
            return { status: 'error', data: null, error: new Error('Expected existing data but got zero rows') }
          }
          return { status: 'empty', data: null }
        }

        lastError = error
        break
      } catch (e) {
        lastError = e
        break
      }
    }

    console.warn('Supabase load failed:', lastError?.message)
    return { status: 'error', data: null, error: lastError }
  }

  try {
    const raw = localStorage.getItem(key)
    return { status: raw ? 'ok' : 'empty', data: raw ? JSON.parse(raw) : null }
  } catch {
    return { status: 'empty', data: null }
  }
}

export async function saveData(userId, payload) {
  const key = localKey(userId)
  try { localStorage.setItem(key, JSON.stringify(payload)) } catch (e) {
    console.warn('localStorage save failed:', e.message)
  }

  if (!userId) return

  const nonEmpty = looksNonEmpty(payload)
  if (nonEmpty) {
    localStorage.setItem(hasDataFlagKey(userId), '1')
  } else {
    const knownLocally = localStorage.getItem(hasDataFlagKey(userId)) === '1'
    let existingIsNonEmpty = false
    if (supabase) {
      try {
        const { data, error } = await fetchRow(userId)
        if (!error && looksNonEmpty(data?.data)) existingIsNonEmpty = true
      } catch (e) {
        // Can't confirm what's currently stored -- treat as risky, same
        // as if we knew it was non-empty, and refuse below.
        existingIsNonEmpty = knownLocally || true
      }
    }
    if (knownLocally || existingIsNonEmpty) {
      // Either this browser has seen real data for this account before,
      // or Supabase currently holds real data right now. Either way,
      // refuse to overwrite it with something that looks empty. This is
      // the final, unconditional checkpoint -- whatever upstream
      // reasoning led here, an accidental wipe is worse than a
      // temporarily-blocked save.
      console.warn('Refused to save: payload looks empty but real data exists. Skipping Supabase write to avoid data loss.')
      return
    }
  }

  if (supabase) {
    try {
      const { error } = await supabase
        .from('user_data')
        .upsert({ user_id: userId, data: payload, updated_at: new Date().toISOString() })
      if (error) console.warn('Supabase save failed:', error.message)
    } catch (e) { console.warn('Supabase save failed:', e.message) }
  }
}

// Explicit, intentional wipe -- the only way to clear a "known non-empty"
// account's local flag. Not wired into the UI; exists so a deliberate
// reset is possible without weakening the guard above.
export function forgetKnownNonEmpty(userId) {
  if (userId) localStorage.removeItem(hasDataFlagKey(userId))
}
