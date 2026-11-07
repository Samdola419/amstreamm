-- AnimeStream Cloud sync schema.
-- One row per authenticated user (email/password). Guest data remains on the device until sign-in.

create table if not exists public.user_library (
  user_id uuid primary key references auth.users (id) on delete cascade,
  my_list jsonb not null default '[]'::jsonb,
  continue_watching jsonb not null default '[]'::jsonb,
  watch_progress jsonb not null default '{}'::jsonb,
  manga_progress jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_library_json_shapes check (
    jsonb_typeof(my_list) = 'array'
    and jsonb_typeof(continue_watching) = 'array'
    and jsonb_typeof(watch_progress) = 'object'
    and jsonb_typeof(manga_progress) = 'object'
    and jsonb_typeof(preferences) = 'object'
  ),
  constraint user_library_data_size check (
    pg_column_size(my_list) < 600000
    and pg_column_size(continue_watching) < 600000
    and pg_column_size(watch_progress) < 600000
    and pg_column_size(manga_progress) < 600000
    and pg_column_size(preferences) < 100000
  )
);

-- Keep the setup safe to re-run against an earlier AnimeStream sync table.
alter table public.user_library
  add column if not exists manga_progress jsonb not null default '{}'::jsonb,
  add column if not exists preferences jsonb not null default '{}'::jsonb;

alter table public.user_library enable row level security;
revoke all on table public.user_library from anon;
grant select, insert, update, delete on table public.user_library to authenticated;
grant usage on schema public to authenticated;

drop policy if exists "user_library_select_own" on public.user_library;
drop policy if exists "user_library_insert_own" on public.user_library;
drop policy if exists "user_library_update_own" on public.user_library;
drop policy if exists "user_library_delete_own" on public.user_library;

create policy "user_library_select_own"
  on public.user_library for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_library_insert_own"
  on public.user_library for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "user_library_update_own"
  on public.user_library for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "user_library_delete_own"
  on public.user_library for delete to authenticated
  using ((select auth.uid()) = user_id);
