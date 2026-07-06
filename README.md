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
VITE_OWNER_EMAIL=your-email@example.com
```
> `VITE_OWNER_EMAIL` — your email. Only this account gets pre-loaded with `ownerSeed.json`. Everyone else starts blank.

### 3. Deploy to Vercel (free, ~5 min)
Push to GitHub → [vercel.com](https://vercel.com) → New Project → import repo → add the 3 env vars → Deploy.

Or via CLI:
```bash
npm install && npx vercel --prod
```

### 4. Port your personal data
1. In the Claude artifact → header → **Download backup (.json)**
2. Rename to `ownerSeed.json` → place in `public/`
3. Redeploy
4. Log in with your owner email — data imports automatically on first login

> After first login, delete `ownerSeed.json` from `public/` and redeploy — your data is safely in Supabase by then.

---

## Data isolation

Each user's data is:
- Stored in their own Supabase row, protected by Row Level Security
- Cached in localStorage under a user-ID-scoped key (`finance-tracker-{userId}`)
- Cleared from localStorage on sign-out

Switching accounts on the same device always loads the correct user's data.

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
