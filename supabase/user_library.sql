create table if not exists public.user_library (
  user_id uuid primary key references auth.users (id) on delete cascade,
  my_list jsonb not null default '[]'::jsonb,
  continue_watching jsonb not null default '[]'::jsonb,
  watch_progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_library_my_list_array check (jsonb_typeof(my_list) = 'array'),
  constraint user_library_continue_watching_array check (jsonb_typeof(continue_watching) = 'array'),
  constraint user_library_watch_progress_object check (jsonb_typeof(watch_progress) = 'object')
);

alter table public.user_library enable row level security;
revoke all on table public.user_library from anon, authenticated;
grant select, insert, update on table public.user_library to authenticated;

drop policy if exists "Users can read their own library" on public.user_library;
create policy "Users can read their own library"
  on public.user_library for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own library" on public.user_library;
create policy "Users can create their own library"
  on public.user_library for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own library" on public.user_library;
create policy "Users can update their own library"
  on public.user_library for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
