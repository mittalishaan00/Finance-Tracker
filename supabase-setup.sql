-- Run this in your Supabase SQL editor

create table if not exists user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table user_data enable row level security;

drop policy if exists "users_own_data" on user_data;
create policy "users_own_data"
  on user_data for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Server-side MFA enforcement. The app's UI already blocks access to
-- anyone who's enrolled a factor but hasn't passed a challenge this
-- session (MfaChallengeGate) -- this policy backs that up at the
-- database level, so a request made directly against the Supabase API
-- with a valid-but-aal1 token can't bypass the UI and read/write this
-- table either. Users who have never enrolled MFA are unaffected: the
-- CASE below only requires aal2 once at least one *verified* factor
-- exists for that user, otherwise aal1 (ordinary password/OAuth login)
-- still works.
--
-- This is a RESTRICTIVE policy, meaning it's ANDed on top of every
-- permissive policy above (including users_own_data) -- it can only
-- narrow access, never grant it on its own.
drop policy if exists "require_aal2_if_mfa_enrolled" on user_data;
create policy "require_aal2_if_mfa_enrolled"
  on user_data
  as restrictive
  for all
  using (
    array[(select auth.jwt()->>'aal')] <@ (
      select
        case
          when count(id) > 0 then array['aal2']
          else array['aal1', 'aal2']
        end
      from auth.mfa_factors
      where auth.mfa_factors.user_id = auth.uid() and status = 'verified'
    )
  )
  with check (
    array[(select auth.jwt()->>'aal')] <@ (
      select
        case
          when count(id) > 0 then array['aal2']
          else array['aal1', 'aal2']
        end
      from auth.mfa_factors
      where auth.mfa_factors.user_id = auth.uid() and status = 'verified'
    )
  );

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists user_data_updated_at on user_data;
create trigger user_data_updated_at
  before update on user_data
  for each row execute function update_updated_at();
