/**
 * crypto.js
 *
 * Client-side, zero-knowledge-style encryption for the data payload this
 * app stores in Supabase.
 *
 * Why this exists: RLS stops other users from reading your row through the
 * API, but it does nothing against a compromised Supabase project, a
 * leaked service-role key, or anyone with direct database access. Once
 * this app holds other people's real transaction/net-worth data, that gap
 * matters. The fix here is to never let plaintext leave the browser: the
 * encryption key is derived from something only the user knows (their
 * password, or a separate passphrase for OAuth sign-ins) and is held only
 * in memory for the current tab. The key itself is never sent to Supabase
 * or written to disk anywhere.
 *
 * Trade-off this creates, by design: if the key isn't in memory (e.g.
 * after a page refresh, or in a new tab), the stored data is
 * unreadable until the user re-enters their password/passphrase to
 * re-derive it. There is deliberately no server-side recovery path,
 * because any such path would mean the server (and therefore anyone who
 * compromises it) could decrypt the data too. Forgetting the encryption
 * passphrase means losing access to the data — that's the whole point.
 *
 * What's covered: the financial payload (transactions, snapshots, cost
 * basis, asset-class map, budgets, rules, categories) that gets written
 * to Supabase and to the localStorage cache. Not covered: your email
 * address and Supabase auth metadata, which Supabase itself needs in
 * plaintext to operate (auth, RLS routing, password reset emails, etc).
 */

const PBKDF2_ITERATIONS = 210000; // OWASP 2023 minimum recommendation for PBKDF2-SHA256
const SALT_BYTES = 16;
const IV_BYTES = 12;

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Generates a fresh random salt (base64) for a brand-new account. Not secret — safe to store alongside the account. */
export function generateSalt() {
  return toB64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

/** Derives a non-extractable AES-GCM CryptoKey from a password/passphrase and stored salt. Same inputs always yield the same key. */
export async function deriveKey(password, saltB64) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromB64(saltB64), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, // not extractable — it can be used, but never read back out or exported
    ["encrypt", "decrypt"]
  );
}

/** Encrypts a JS value under the given key. Returns a small envelope object safe to store as-is. */
export async function encryptPayload(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    __encrypted: "v1",
    iv: toB64(iv),
    ciphertext: toB64(ciphertext),
  };
}

/** Reverses encryptPayload. Throws if the key is wrong (wrong password/passphrase) or data is corrupt — callers should treat that as "needs unlock", not "empty account". */
export async function decryptPayload(key, envelope) {
  const iv = new Uint8Array(fromB64(envelope.iv));
  const ciphertext = fromB64(envelope.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export function isEncryptedEnvelope(payload) {
  return !!payload && typeof payload === "object" && payload.__encrypted === "v1"
    && typeof payload.iv === "string" && typeof payload.ciphertext === "string";
}
