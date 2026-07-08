# Finance Tracker

Personal net worth & cash flow dashboard. Each user's data is fully isolated — stored in their own Supabase row with Row Level Security.

## Deploy in 4 steps

### 1. Set up Supabase (free, ~10 min)
1. Create account at [supabase.com](https://supabase.com) → New project
2. SQL Editor → paste `supabase-setup.sql` → Run
3. Settings → API → copy **Project URL** and **anon public** key

### 2. Configure environment
```bash
cp .env.example .env.local
```
Fill in `.env.local`:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Deploy to Vercel (free, ~5 min)
Push to GitHub → [vercel.com](https://vercel.com) → New Project → import repo → add the 2 env vars → Deploy.

Or via CLI:
```bash
npm install && npx vercel --prod
```

Every account — including yours — starts empty and imports its own statements from there. There's no special-cased "owner" account or pre-seeded data file anymore: nothing but your own Supabase row (RLS-protected) ever holds your numbers.

---

## Data isolation

Each user's data is:
- Stored in their own Supabase row, protected by Row Level Security
- Cached in localStorage under a user-ID-scoped key (`finance-tracker-{userId}`)
- Cleared from localStorage on sign-out

Switching accounts on the same device always loads the correct user's data.

---

## Encryption

Financial data (transactions, snapshots, cost basis, budgets, etc.) is encrypted in the browser with AES-GCM before it's written to Supabase or to the localStorage cache. The key is derived (PBKDF2) from:
- **Password accounts** — the same password used to sign in.
- **Google accounts** — a separate "data passphrase," since there's no password to derive from. Set once on first login, entered again on every later session.

The key lives only in memory for the current tab — never in Supabase, never on disk. This means:
- After every page refresh, the user re-enters their password/passphrase on an "Unlock" screen before the app can decrypt and show anything.
- **There is no recovery path if a data passphrase (Google accounts) is forgotten.** That's inherent to the design, not a bug — a recoverable key would mean the server could decrypt the data too.
- Changing a password or passphrase (Security tab → Change password/passphrase) automatically re-encrypts existing data with the new key in the same step, so nothing gets orphaned. If that re-encrypt step fails partway (e.g. a network drop) after a password change has already gone through, the app keeps working normally for the rest of that session on the old key and offers a "Finish re-encrypting" retry — but closing the tab before it completes would leave the stored data encrypted under a key the new password can no longer derive. This only affects an in-app password change; a password reset via Supabase's own "forgot password" email flow happens outside the app entirely and still can't preserve access to already-encrypted data, since by definition nobody types the old password anywhere in that flow.
- Old rows saved before this feature existed are plaintext and get transparently encrypted on the very next save.

See `src/crypto.js` for the implementation and the reasoning behind these trade-offs.

## Two-factor authentication

Users can enable TOTP (authenticator app) MFA from the **Security** tab. Supabase Auth handles enrollment, challenge, and verification natively — no extra backend needed, and it's free on all plans. Once enabled, a 6-digit code is required at every login.

Enforcement is two layers deep:
- **UI**: `MfaChallengeGate` blocks the app from rendering until a challenge is passed, for anyone who's enrolled a factor.
- **Database**: `supabase-setup.sql` adds a restrictive Row Level Security policy that requires an `aal2` session for any user with a verified MFA factor, on every read and write to `user_data` — so a request made directly against the Supabase API (bypassing the UI entirely) can't get around it either. Users who haven't enrolled MFA are unaffected.

If you already ran `supabase-setup.sql` before this policy existed, just re-run the whole file again — every statement in it is idempotent (`drop ... if exists` before each `create`).

---

## Troubleshooting

**Stuck on login page after signing up**
Supabase requires email confirmation by default.
- Check inbox for confirmation email, OR
- Supabase Dashboard → Authentication → Settings → Email → disable "Enable email confirmations"

**Google sign-in redirects back to login**
Supabase → Authentication → URL Configuration → Redirect URLs → add your Vercel URL

**Data not syncing across devices**
Make sure you ran `supabase-setup.sql`. Without the table, saves fall back to localStorage silently.

---

## Running locally
```bash
npm install
npm run dev
# open http://localhost:5173
```

Without `.env.local`, runs as anonymous single-user with localStorage only.
