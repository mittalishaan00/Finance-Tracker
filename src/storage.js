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
        return data.data
      }
    } catch (e) {
      console.warn('Supabase load failed, using localStorage:', e.message)
    }
  }

  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
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
