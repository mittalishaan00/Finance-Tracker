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

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists user_data_updated_at on user_data;
create trigger user_data_updated_at
  before update on user_data
  for each row execute function update_updated_at();
