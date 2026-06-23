/**
 * Storage abstraction.
 *
 * When Supabase is configured and a user is logged in:
 *   - saves data to Supabase (syncs across devices)
 *   - mirrors to localStorage as a fast local cache
 *
 * When running offline / not logged in:
 *   - saves to localStorage only
 *
 * The data shape is a single JSON blob per user, stored in the
 * `user_data` table: { user_id, data jsonb, updated_at }
 *
 * SQL to create the table in Supabase:
 *   create table user_data (
 *     user_id uuid primary key references auth.users(id) on delete cascade,
 *     data    jsonb not null default '{}',
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table user_data enable row level security;
 *   create policy "Users can only access their own data"
 *     on user_data for all using (auth.uid() = user_id);
 */

import { supabase } from './supabase'

const LOCAL_KEY = 'finance-tracker-data'

export async function loadData(userId) {
  // 1. Try Supabase if available
  if (supabase && userId) {
    try {
      const { data, error } = await supabase
        .from('user_data')
        .select('data')
        .eq('user_id', userId)
        .single()

      if (!error && data?.data) {
        // Mirror to localStorage for offline resilience
        localStorage.setItem(LOCAL_KEY, JSON.stringify(data.data))
        return data.data
      }
    } catch (e) {
      console.warn('Supabase load failed, falling back to localStorage:', e.message)
    }
  }

  // 2. Fall back to localStorage
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function saveData(userId, payload) {
  // Always save to localStorage immediately (fast, works offline)
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(payload))
  } catch (e) {
    console.warn('localStorage save failed:', e.message)
  }

  // Then sync to Supabase in the background
  if (supabase && userId) {
    try {
      const { error } = await supabase
        .from('user_data')
        .upsert({ user_id: userId, data: payload, updated_at: new Date().toISOString() })

      if (error) console.warn('Supabase save failed:', error.message)
    } catch (e) {
      console.warn('Supabase save failed:', e.message)
    }
  }
}
