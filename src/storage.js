/**
 * storage.js
 *
 * localStorage keys are scoped to userId so multiple users
 * on the same device never see each other's data.
 *
 * Encryption: both the Supabase row and the localStorage cache can hold
 * either a plain payload object (legacy, or encryption not yet set up)
 * or an encrypted envelope ({ __encrypted, iv, ciphertext }). Every
 * function here takes an optional `encryptionKey` (an in-memory-only
 * CryptoKey from crypto.js, supplied by AuthContext once the user has
 * unlocked their session) and encrypts/decrypts transparently around it.
 * If no key is supplied, behaviour is unchanged from before encryption
 * existed. See crypto.js for why the key never touches disk or the
 * network.
 */
import { supabase } from './supabase'
import { encryptPayload, decryptPayload, isEncryptedEnvelope } from './crypto'

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

// Reads the local cache and returns the plain (decrypted) object. If the
// cached copy is encrypted and no key is available, it's unusable --
// treated the same as "no cache", never returned as-is.
async function readLocalCache(key, encryptionKey) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (isEncryptedEnvelope(parsed)) {
      if (!encryptionKey) return null
      const plain = await decryptPayload(encryptionKey, parsed)
      return looksNonEmpty(plain) ? plain : null
    }
    return looksNonEmpty(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function writeLocalCache(key, payload, encryptionKey) {
  try {
    if (encryptionKey) {
      const envelope = await encryptPayload(encryptionKey, payload)
      localStorage.setItem(key, JSON.stringify(envelope))
    } else {
      localStorage.setItem(key, JSON.stringify(payload))
    }
  } catch (e) {
    console.warn('localStorage save failed:', e.message)
  }
}

export async function loadData(userId, encryptionKey) {
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
          let plain = data.data
          if (isEncryptedEnvelope(plain)) {
            if (!encryptionKey) {
              // Real (encrypted) data exists but we have no key to open it
              // with. Should not normally happen -- the app gates behind
              // an unlock step first -- but if it does, fail loudly rather
              // than ever falling through to blank state.
              return { status: 'error', data: null, error: new Error('Encrypted data present but no encryption key available') }
            }
            try {
              plain = await decryptPayload(encryptionKey, plain)
            } catch {
              return { status: 'error', data: null, error: new Error('Could not decrypt stored data — wrong password or passphrase') }
            }
          }
          await writeLocalCache(key, plain, encryptionKey)
          if (looksNonEmpty(plain)) localStorage.setItem(hasDataFlagKey(userId), '1')
          return { status: 'ok', data: plain }
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
    const cached = await readLocalCache(key, encryptionKey)
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

  const cached = await readLocalCache(key, encryptionKey)
  return cached ? { status: 'ok', data: cached } : { status: 'empty', data: null }
}

export async function saveData(userId, payload, encryptionKey) {
  const key = localKey(userId)
  await writeLocalCache(key, payload, encryptionKey)

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
      // Encrypting here (rather than leaving it plaintext) means every
      // save transparently migrates a legacy plaintext row to an
      // encrypted one the moment a user has unlocked with a key -- no
      // separate migration step needed.
      const toWrite = encryptionKey ? await encryptPayload(encryptionKey, payload) : payload
      const { error } = await supabase
        .from('user_data')
        .upsert({ user_id: userId, data: toWrite, updated_at: new Date().toISOString() })
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

// Confirms a candidate key actually opens this account's existing data,
// without committing to it. Used by the unlock screen so a wrong
// password/passphrase is caught immediately with a clear error, instead
// of silently producing a decrypt failure deeper in the app later.
// Returns true when there's nothing to verify against yet (brand-new
// account, or an existing row that isn't encrypted).
export async function verifyKey(userId, encryptionKey) {
  if (!supabase || !userId) return true
  try {
    const { data, error } = await fetchRow(userId)
    if (error || !data?.data) return true
    if (!isEncryptedEnvelope(data.data)) return true
    await decryptPayload(encryptionKey, data.data)
    return true
  } catch {
    return false
  }
}

// Re-encrypts the account's stored row (and local cache) from oldKey to
// newKey -- the whole point of a password/passphrase change, since the
// derived key changes the moment the secret it's derived from changes.
// Without this, changing a password silently orphans all previously
// encrypted data: the next unlock attempt would derive a brand-new key
// that can't open a row still encrypted under the old one.
//
// Deliberately does NOT touch Supabase Auth's password itself -- callers
// are responsible for sequencing this alongside their own
// auth.updateUser({ password }) call, and for deciding what to do if one
// half succeeds and the other fails (see AuthContext usage).
export async function reencryptData(userId, oldKey, newKey) {
  if (!supabase || !userId) return { ok: false, error: new Error('Not available in offline mode') }
  try {
    const { data, error } = await fetchRow(userId)
    if (error && error.code !== 'PGRST116') return { ok: false, error }

    let plain = {}
    if (data?.data) {
      const raw = data.data
      if (isEncryptedEnvelope(raw)) {
        if (!oldKey) return { ok: false, error: new Error('Missing current encryption key') }
        try {
          plain = await decryptPayload(oldKey, raw)
        } catch {
          return { ok: false, error: new Error('Could not decrypt existing data with the current key') }
        }
      } else {
        plain = raw // legacy plaintext row -- just carries forward as-is, now encrypted
      }
    } else {
      // Nothing saved yet for this account -- nothing to migrate.
      return { ok: true }
    }

    const envelope = await encryptPayload(newKey, plain)
    const { error: upsertError } = await supabase
      .from('user_data')
      .upsert({ user_id: userId, data: envelope, updated_at: new Date().toISOString() })
    if (upsertError) return { ok: false, error: upsertError }

    await writeLocalCache(localKey(userId), plain, newKey)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e }
  }
}
