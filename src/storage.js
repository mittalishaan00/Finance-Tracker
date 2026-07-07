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

  const readLocalCache = () => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return looksNonEmpty(parsed) ? parsed : null
    } catch { return null }
  }

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
          // Zero rows. Retry briefly first in case it's just the session race.
          if (attempt < 2) { await sleep(250); continue }
          break
        }

        lastError = error
        break
      } catch (e) {
        lastError = e
        break
      }
    }

    // The live read failed or came back empty after retries. Before
    // concluding anything, fall back to this browser's own last-known
    // cache of this account's real data -- this is the actual fix for
    // the login-timing race: rather than trying to perfectly predict
    // whether "zero rows" means "new account" or "race," just prefer
    // real cached data over a network hiccup whenever we have it.
    const cached = readLocalCache()
    if (cached) {
      return { status: 'ok', data: cached }
    }

    if (knownNonEmpty) {
      // We've confirmed this account has real data before (in this
      // browser), yet there's no cache and the live read failed -- treat
      // as a genuine failure rather than a fresh account.
      return { status: 'error', data: null, error: lastError ?? new Error('Expected existing data but got zero rows') }
    }

    if (lastError) {
      console.warn('Supabase load failed:', lastError.message)
      return { status: 'error', data: null, error: lastError }
    }

    return { status: 'empty', data: null }
  }

  const cached = readLocalCache()
  return cached ? { status: 'ok', data: cached } : { status: 'empty', data: null }
}

export async function saveData(userId, payload) {
  const key = localKey(userId)
  try { localStorage.setItem(key, JSON.stringify(payload)) } catch (e) {
    console.warn('localStorage save failed:', e.message)
  }

  if (!userId) return

  if (looksNonEmpty(payload)) {
    localStorage.setItem(hasDataFlagKey(userId), '1')
  } else {
    // Unconditional rule, no exceptions: a payload with no snapshots,
    // transactions, categories, cost basis, or asset classes is never
    // written to Supabase. There is no legitimate everyday reason for
    // real user data to autosave down to nothing, so this can only be a
    // bug (a stale/blank in-memory state, a load race, a bad remount,
    // etc). Refusing here -- rather than trying to detect whether THIS
    // particular empty state is "safe" -- removes the race condition
    // entirely, because there is nothing left to race: empty payloads
    // simply never reach the network call that could destroy real data.
    console.warn('Refused to save: payload is empty. Skipping Supabase write to avoid overwriting real data.')
    return
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
