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
```

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

## Customise

- **Branding**: edit the app name and colours at the top of `App.jsx`
- **Default categories**: edit `DEFAULT_INCOME_CATEGORIES` and `DEFAULT_EXPENSE_CATEGORIES`
- **Seed data**: remove or replace `SEED_DATES` / `SEED_VALUES` at the top of `App.jsx` if you don't want demo data pre-loaded
