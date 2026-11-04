-- AnimeStream cloud sync. Run once in Supabase: SQL Editor > New query > paste > Run.
-- One row per signed-in user. Guests never touch the database (their data stays on the device).

create table if not exists public.user_data (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  mylist        jsonb not null default '[]'::jsonb,
  continue_list jsonb not null default '[]'::jsonb,
  progress      jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  constraint user_data_size check (
    pg_column_size(mylist) < 600000 and pg_column_size(continue_list) < 600000 and pg_column_size(progress) < 600000
  )
);

alter table public.user_data enable row level security;

-- Only signed-in users, and only their own row.
revoke all on public.user_data from anon;
grant select, insert, update, delete on public.user_data to authenticated;

drop policy if exists "own row select" on public.user_data;
drop policy if exists "own row insert" on public.user_data;
drop policy if exists "own row update" on public.user_data;
drop policy if exists "own row delete" on public.user_data;

create policy "own row select" on public.user_data for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own row insert" on public.user_data for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own row update" on public.user_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "own row delete" on public.user_data for delete to authenticated
  using ((select auth.uid()) = user_id);
