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

export function clearOtherUsersCache(currentUserId) {
  const keep = localKey(currentUserId)
  Object.keys(localStorage)
    .filter(k => k.startsWith('finance-tracker-') && k !== keep)
    .forEach(k => localStorage.removeItem(k))
}

export async function loadData(userId) {
  const key = localKey(userId)

  if (supabase && userId) {
    try {
      const { data, error } = await supabase
        .from('user_data')
        .select('data')
        .eq('user_id', userId)
        .single()

      if (!error && data?.data) {
        localStorage.setItem(key, JSON.stringify(data.data))
        return { status: 'ok', data: data.data }
      }

      // PGRST116 = no row found for this user yet -- a genuinely new
      // account, safe to start blank.
      if (error && error.code === 'PGRST116') {
        return { status: 'empty', data: null }
      }

      if (error) {
        console.warn('Supabase load failed:', error.message)
        return { status: 'error', data: null, error }
      }

      // No error, but also no data.data -- treat as empty.
      return { status: 'empty', data: null }
    } catch (e) {
      // Network failure, RLS/auth issue, etc. This is NOT the same as
      // "no data" -- the caller must not treat this as a blank slate,
      // or it risks overwriting the user's real cloud data on next save.
      console.warn('Supabase load failed:', e.message)
      return { status: 'error', data: null, error: e }
    }
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
  if (supabase && userId) {
    try {
      const { error } = await supabase
        .from('user_data')
        .upsert({ user_id: userId, data: payload, updated_at: new Date().toISOString() })
      if (error) console.warn('Supabase save failed:', error.message)
    } catch (e) { console.warn('Supabase save failed:', e.message) }
  }
}
