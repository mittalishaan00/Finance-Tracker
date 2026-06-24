# Finance Tracker

A personal net worth and cash flow dashboard. Fully client-side — your financial data never touches any third-party server except your own Supabase database.

## Features

- Net worth tracking with historical snapshots
- Cash flow (income & expenses) with categorisation rules
- Budget vs actual comparison
- PDF and CSV statement import (parsed locally in your browser)
- Historical FX rates for AED/USD/INR
- Multi-currency display (INR / USD / AED)
- XIRR-based return calculation
- Excel export/import

---

## Deploy in 4 steps

### 1. Set up Supabase (free)

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Create a new project (pick any name and region)
3. Once created, go to **SQL Editor** and run the contents of `supabase-setup.sql`
4. Go to **Settings → API** and copy:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon public** key

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_OWNER_EMAIL=your-email@example.com
```

> `VITE_OWNER_EMAIL` controls whose account sees the pre-loaded demo/seed data. Set it to your email. Everyone else starts with a blank slate.

### 3. Enable Google sign-in (optional but recommended)

In Supabase dashboard:
1. Go to **Authentication → Providers → Google**
2. Enable it and follow the instructions to create a Google OAuth app
3. Add your deployment URL to the allowed redirect URLs

If you skip this, users can still sign up with email/password.

### 4. Deploy to Vercel (free)

**Option A: GitHub (recommended)**

1. Push this folder to a GitHub repository
2. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
3. Add environment variables in Vercel's dashboard (same as `.env.local`)
4. Deploy — done

**Option B: Vercel CLI**

```bash
npm install -g vercel
vercel --prod
```

Vercel will prompt you to add environment variables.

---

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Running without Supabase (offline mode)

If you don't set up Supabase credentials, the app runs in single-user mode with data stored in `localStorage`. No login required. Useful for local personal use.

---

## Architecture

```
src/
  main.jsx          # React entry point
  Root.jsx          # Auth gate + window.storage shim
  App.jsx           # Main application (all features)
  AuthContext.jsx   # Supabase auth state
  LoginPage.jsx     # Sign in / sign up UI
  storage.js        # Saves to Supabase + localStorage
  supabase.js       # Supabase client
```

**Data model:** Each user has a single row in `user_data` containing their entire app state as a JSON blob. This keeps the schema simple and makes backup/restore trivial.

**Security:**
- Row Level Security in Supabase ensures users can only ever access their own data
- The Supabase anon key is safe to expose in client-side code — it only allows what RLS permits
- No financial data is sent to any server other than your own Supabase project

---

## Troubleshooting

**Login page shows but I can't get in after signing up**

Supabase requires email confirmation by default. Either:
- Check your inbox for a confirmation email and click the link, **or**
- Disable it: Supabase Dashboard → **Authentication → Settings → Email** → turn off "Enable email confirmations"

**Google sign-in redirects back to login**

Add your site's URL to Supabase: **Authentication → URL Configuration → Redirect URLs** → add `https://your-app.vercel.app`

**Data not saving across devices**

Make sure you ran `supabase-setup.sql` in the SQL editor. Without the `user_data` table, Supabase saves silently fail and the app falls back to localStorage (device-only).

---

- **Branding**: edit the app name and colours at the top of `App.jsx`
- **Default categories**: edit `DEFAULT_INCOME_CATEGORIES` and `DEFAULT_EXPENSE_CATEGORIES`
- **Seed data**: remove or replace `SEED_DATES` / `SEED_VALUES` at the top of `App.jsx` if you don't want demo data pre-loaded

---

## Porting your personal data to the website

Your financial data lives in the Claude artifact. To get it into your account on the deployed website:

### Step 1 — Export from the artifact

In the Claude artifact (this chat), go to the header → **Download backup (.json)**. This downloads a file called something like `networth-backup-2026-06-24.json`.

### Step 2 — Add it to the project

Rename the file to exactly `ownerSeed.json` and place it in the `public/` folder:

```
finance-app/
  public/
    favicon.svg
    ownerSeed.json   ← put it here
```

### Step 3 — Deploy

Push to GitHub / redeploy on Vercel as normal. Vercel will serve `ownerSeed.json` as a static file.

### Step 4 — First login

Log into the website with your owner email (`VITE_OWNER_EMAIL`). If your Supabase account has no data yet, the app detects this and automatically imports `ownerSeed.json` into your account, then reloads. You'll see "Importing your data…" for a moment.

**This only runs once** — on subsequent logins it sees your data already exists and skips the seed. The `ownerSeed.json` file remains in `public/` but is only used on first login.

> ⚠️ `ownerSeed.json` contains your financial data. It is served publicly (anyone who knows the URL can download it). If this concerns you, delete it from `public/` after your first login — the data is safely in Supabase by then.
