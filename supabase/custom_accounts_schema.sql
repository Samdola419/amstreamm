-- AnimeStream custom accounts (does NOT use Supabase Auth / auth.users).
-- Apply before rooms_schema.sql when recreating this database.

create table if not exists public.animestream_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists animestream_accounts_email_lower_uidx
  on public.animestream_accounts (lower(email));

create table if not exists public.animestream_sessions (
  token_hash text primary key,
  account_id uuid not null references public.animestream_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists animestream_sessions_account_idx on public.animestream_sessions(account_id);
create index if not exists animestream_sessions_expiry_idx on public.animestream_sessions(expires_at);

create table if not exists public.animestream_account_library (
  account_id uuid primary key references public.animestream_accounts(id) on delete cascade,
  my_list jsonb not null default '[]'::jsonb,
  continue_watching jsonb not null default '[]'::jsonb,
  watch_progress jsonb not null default '{}'::jsonb,
  manga_progress jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint animestream_library_shapes check (
    jsonb_typeof(my_list) = 'array'
    and jsonb_typeof(continue_watching) = 'array'
    and jsonb_typeof(watch_progress) = 'object'
    and jsonb_typeof(manga_progress) = 'object'
    and jsonb_typeof(preferences) = 'object'
  )
);

create table if not exists public.animestream_auth_limits (
  key_hash text primary key,
  window_started_at timestamptz not null,
  attempts integer not null default 0,
  blocked_until timestamptz
);

create or replace function public.consume_animestream_auth_attempt(
  p_key_hash text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.animestream_auth_limits%rowtype;
  v_now timestamptz := pg_catalog.now();
begin
  insert into public.animestream_auth_limits(key_hash,window_started_at,attempts,blocked_until)
  values(p_key_hash,v_now,1,null) on conflict(key_hash) do nothing;
  select * into v_row from public.animestream_auth_limits where key_hash=p_key_hash for update;
  if v_row.blocked_until is not null and v_row.blocked_until>v_now then return false; end if;
  if v_row.window_started_at+pg_catalog.make_interval(secs=>p_window_seconds)<=v_now then
    update public.animestream_auth_limits set window_started_at=v_now,attempts=1,blocked_until=null where key_hash=p_key_hash;
    return true;
  end if;
  if v_row.attempts>=p_limit then
    update public.animestream_auth_limits set blocked_until=v_now+pg_catalog.make_interval(secs=>p_window_seconds) where key_hash=p_key_hash;
    return false;
  end if;
  update public.animestream_auth_limits set attempts=attempts+1 where key_hash=p_key_hash;
  return true;
end;
$$;

alter table public.animestream_accounts enable row level security;
alter table public.animestream_sessions enable row level security;
alter table public.animestream_account_library enable row level security;
alter table public.animestream_auth_limits enable row level security;
revoke all on table public.animestream_accounts from public,anon,authenticated;
revoke all on table public.animestream_sessions from public,anon,authenticated;
revoke all on table public.animestream_account_library from public,anon,authenticated;
revoke all on table public.animestream_auth_limits from public,anon,authenticated;
grant all on table public.animestream_accounts to service_role;
grant all on table public.animestream_sessions to service_role;
grant all on table public.animestream_account_library to service_role;
grant all on table public.animestream_auth_limits to service_role;

-- Explicit deny policies protect the tables even if permissions are changed later.
drop policy if exists animestream_accounts_deny_clients on public.animestream_accounts;
drop policy if exists animestream_sessions_deny_clients on public.animestream_sessions;
drop policy if exists animestream_account_library_deny_clients on public.animestream_account_library;
drop policy if exists animestream_auth_limits_deny_clients on public.animestream_auth_limits;
create policy animestream_accounts_deny_clients on public.animestream_accounts for all to anon,authenticated using(false) with check(false);
create policy animestream_sessions_deny_clients on public.animestream_sessions for all to anon,authenticated using(false) with check(false);
create policy animestream_account_library_deny_clients on public.animestream_account_library for all to anon,authenticated using(false) with check(false);
create policy animestream_auth_limits_deny_clients on public.animestream_auth_limits for all to anon,authenticated using(false) with check(false);

revoke all on function public.consume_animestream_auth_attempt(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_animestream_auth_attempt(text,integer,integer) to service_role;
