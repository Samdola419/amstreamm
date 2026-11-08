-- AnimeStream watch rooms. All room data is accessed through the custom-session
-- Edge Function; browser roles have no direct table access.

create table if not exists public.animestream_watch_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code varchar(8) not null unique,
  channel_topic text not null unique,
  host_account_id uuid not null references public.animestream_accounts(id) on delete cascade,
  status text not null default 'active' check (status in ('active','ended','expired')),
  media_type text not null check (media_type in ('anime','movie','tv')),
  media jsonb not null default '{}'::jsonb,
  playback_state text not null default 'paused' check (playback_state in ('playing','paused')),
  position_seconds numeric(12,3) not null default 0 check (position_seconds >= 0),
  playback_updated_at timestamptz not null default now(),
  playback_seq bigint not null default 0,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '6 hours')
);
create index if not exists animestream_watch_rooms_status_expiry_idx
  on public.animestream_watch_rooms(status, expires_at);
create index if not exists animestream_watch_rooms_host_account_idx
  on public.animestream_watch_rooms(host_account_id);

create table if not exists public.animestream_watch_room_members (
  room_id uuid not null references public.animestream_watch_rooms(id) on delete cascade,
  account_id uuid not null references public.animestream_accounts(id) on delete cascade,
  role text not null default 'member' check (role in ('host','member')),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (room_id, account_id)
);
create index if not exists animestream_watch_room_members_active_idx
  on public.animestream_watch_room_members(room_id, left_at, last_seen_at);
create index if not exists animestream_watch_room_members_account_idx
  on public.animestream_watch_room_members(account_id);

create table if not exists public.animestream_watch_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.animestream_watch_rooms(id) on delete cascade,
  sender_account_id uuid not null references public.animestream_accounts(id) on delete cascade,
  body varchar(500) not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists animestream_watch_room_messages_room_created_idx
  on public.animestream_watch_room_messages(room_id, created_at desc, id desc);
create index if not exists animestream_watch_room_messages_sender_idx
  on public.animestream_watch_room_messages(sender_account_id);

-- Atomic join: a row lock ensures simultaneous requests cannot exceed four people.
create or replace function public.join_animestream_watch_room(
  p_room_id uuid,
  p_account_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.animestream_watch_rooms%rowtype;
  v_existing public.animestream_watch_room_members%rowtype;
  v_count integer;
  v_active_host uuid;
begin
  select * into v_room
  from public.animestream_watch_rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_room.status <> 'active' or v_room.expires_at <= pg_catalog.now() then
    return jsonb_build_object('ok', false, 'reason', 'ended');
  end if;

  update public.animestream_watch_room_members
  set left_at = pg_catalog.now()
  where room_id = p_room_id
    and left_at is null
    and last_seen_at < pg_catalog.now() - interval '2 minutes';

  select account_id into v_active_host
  from public.animestream_watch_room_members
  where room_id = p_room_id and account_id = v_room.host_account_id
    and left_at is null and last_seen_at >= pg_catalog.now() - interval '2 minutes';

  if not found then
    select account_id into v_active_host
    from public.animestream_watch_room_members
    where room_id = p_room_id and left_at is null
      and last_seen_at >= pg_catalog.now() - interval '2 minutes'
    order by joined_at asc limit 1;
    if found then
      update public.animestream_watch_room_members set role='member'
        where room_id=p_room_id and role='host';
      update public.animestream_watch_room_members set role='host'
        where room_id=p_room_id and account_id=v_active_host;
      update public.animestream_watch_rooms set host_account_id=v_active_host
        where id=p_room_id;
    end if;
  end if;

  select * into v_existing
  from public.animestream_watch_room_members
  where room_id = p_room_id and account_id = p_account_id;

  if found and v_existing.left_at is null then
    update public.animestream_watch_room_members
    set last_seen_at = pg_catalog.now()
    where room_id = p_room_id and account_id = p_account_id;
    return jsonb_build_object('ok', true, 'already_member', true);
  end if;

  select pg_catalog.count(*) into v_count
  from public.animestream_watch_room_members
  where room_id = p_room_id and left_at is null
    and last_seen_at >= pg_catalog.now() - interval '2 minutes';

  if v_count >= 4 then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  insert into public.animestream_watch_room_members(room_id, account_id, role, joined_at, last_seen_at, left_at)
  values (p_room_id, p_account_id, case when v_count = 0 then 'host' else 'member' end, pg_catalog.now(), pg_catalog.now(), null)
  on conflict (room_id, account_id) do update
    set role = excluded.role, joined_at = pg_catalog.now(), last_seen_at = pg_catalog.now(), left_at = null;

  update public.animestream_watch_rooms
  set host_account_id = case when v_count = 0 then p_account_id else host_account_id end,
      last_activity_at = pg_catalog.now(), expires_at = greatest(expires_at, pg_catalog.now() + interval '30 minutes')
  where id = p_room_id;

  return jsonb_build_object('ok', true, 'already_member', false, 'became_host', v_count = 0);
end;
$$;

create or replace function public.bump_animestream_watch_room_revision(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic text;
  v_revision bigint;
begin
  update public.animestream_watch_rooms
    set revision = revision + 1,
        last_activity_at = pg_catalog.now(),
        expires_at = pg_catalog.now() + interval '6 hours'
    where id = p_room_id
    returning channel_topic, revision into v_topic, v_revision;
  if not found then return null; end if;
  return jsonb_build_object('channel_topic', v_topic, 'revision', v_revision);
end;
$$;

revoke all on function public.bump_animestream_watch_room_revision(uuid) from public, anon, authenticated;
grant execute on function public.bump_animestream_watch_room_revision(uuid) to service_role;

alter table public.animestream_watch_rooms enable row level security;
alter table public.animestream_watch_room_members enable row level security;
alter table public.animestream_watch_room_messages enable row level security;

revoke all on table public.animestream_watch_rooms from public, anon, authenticated;
revoke all on table public.animestream_watch_room_members from public, anon, authenticated;
revoke all on table public.animestream_watch_room_messages from public, anon, authenticated;
grant all on table public.animestream_watch_rooms to service_role;
grant all on table public.animestream_watch_room_members to service_role;
grant all on table public.animestream_watch_room_messages to service_role;

-- Explicit deny policies provide defence in depth if privileges are changed later.
drop policy if exists animestream_watch_rooms_deny_clients on public.animestream_watch_rooms;
drop policy if exists animestream_watch_room_members_deny_clients on public.animestream_watch_room_members;
drop policy if exists animestream_watch_room_messages_deny_clients on public.animestream_watch_room_messages;
create policy animestream_watch_rooms_deny_clients on public.animestream_watch_rooms
  for all to anon, authenticated using (false) with check (false);
create policy animestream_watch_room_members_deny_clients on public.animestream_watch_room_members
  for all to anon, authenticated using (false) with check (false);
create policy animestream_watch_room_messages_deny_clients on public.animestream_watch_room_messages
  for all to anon, authenticated using (false) with check (false);

revoke all on function public.join_animestream_watch_room(uuid, uuid) from public, anon, authenticated;
grant execute on function public.join_animestream_watch_room(uuid, uuid) to service_role;

-- A member leaving rotates the Realtime topic so the departing browser cannot
-- keep listening on the previous public capability topic. Empty rooms are deleted.
create or replace function public.leave_animestream_watch_room(
  p_room_id uuid,
  p_account_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.animestream_watch_rooms%rowtype;
  v_role text;
  v_next_host uuid;
  v_remaining integer;
  v_now timestamptz := pg_catalog.now();
begin
  select * into v_room
  from public.animestream_watch_rooms
  where id = p_room_id
  for update;
  if not found then return jsonb_build_object('ok', true, 'deleted', true); end if;

  select role into v_role
  from public.animestream_watch_room_members
  where room_id = p_room_id and account_id = p_account_id and left_at is null
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_member'); end if;

  update public.animestream_watch_room_members
  set left_at = v_now
  where room_id = p_room_id and account_id = p_account_id;

  -- Reclaim long-abandoned tabs when another participant leaves.
  update public.animestream_watch_room_members
  set left_at = v_now
  where room_id = p_room_id and left_at is null
    and last_seen_at < v_now - interval '2 minutes';

  select pg_catalog.count(*) into v_remaining
  from public.animestream_watch_room_members
  where room_id = p_room_id and left_at is null;

  if v_remaining = 0 then
    delete from public.animestream_watch_rooms where id = p_room_id;
    return jsonb_build_object('ok', true, 'deleted', true, 'topic', v_room.channel_topic, 'room_id', p_room_id);
  end if;

  if v_role = 'host' then
    select account_id into v_next_host
    from public.animestream_watch_room_members
    where room_id = p_room_id and left_at is null
    order by joined_at asc
    limit 1;

    update public.animestream_watch_room_members
    set role = case when account_id = v_next_host then 'host' else 'member' end
    where room_id = p_room_id and left_at is null;

    update public.animestream_watch_rooms
    set host_account_id = v_next_host,
        channel_topic = 'watch-room:' || pg_catalog.gen_random_uuid()::text,
        revision = revision + 1,
        last_activity_at = v_now
    where id = p_room_id;

    return jsonb_build_object('ok', true, 'deleted', false, 'host_changed', true,
      'new_host_account_id', v_next_host, 'topic', v_room.channel_topic, 'room_id', p_room_id);
  end if;

  update public.animestream_watch_rooms
  set channel_topic = 'watch-room:' || pg_catalog.gen_random_uuid()::text,
      revision = revision + 1,
      last_activity_at = v_now
  where id = p_room_id;

  return jsonb_build_object('ok', true, 'deleted', false, 'host_changed', false,
    'topic', v_room.channel_topic, 'room_id', p_room_id);
end;
$$;

-- Ending a room is destructive by design: FK cascades erase its invite code,
-- memberships, and chat messages in the same transaction.
create or replace function public.end_animestream_watch_room(
  p_room_id uuid,
  p_account_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic text;
  v_role text;
begin
  select channel_topic into v_topic
  from public.animestream_watch_rooms
  where id = p_room_id
  for update;
  if not found then return jsonb_build_object('ok', true, 'deleted', true); end if;

  select role into v_role
  from public.animestream_watch_room_members
  where room_id = p_room_id and account_id = p_account_id and left_at is null
  for update;
  if not found or v_role <> 'host' then
    return jsonb_build_object('ok', false, 'reason', 'host_required');
  end if;

  delete from public.animestream_watch_rooms where id = p_room_id;
  return jsonb_build_object('ok', true, 'deleted', true, 'topic', v_topic, 'room_id', p_room_id);
end;
$$;

revoke all on function public.leave_animestream_watch_room(uuid, uuid) from public, anon, authenticated;
revoke all on function public.end_animestream_watch_room(uuid, uuid) from public, anon, authenticated;
grant execute on function public.leave_animestream_watch_room(uuid, uuid) to service_role;
grant execute on function public.end_animestream_watch_room(uuid, uuid) to service_role;


-- Atomic playback snapshot + revision. Progress pulses cannot change a paused room.
drop function if exists public.update_animestream_watch_room_playback(uuid,numeric,text,timestamptz,jsonb,text,boolean);

create or replace function public.update_animestream_watch_room_playback(
  p_room_id uuid,
  p_position_seconds numeric,
  p_playback_state text,
  p_playback_updated_at timestamptz,
  p_media jsonb,
  p_media_type text,
  p_position_only boolean,
  p_playback_seq bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_topic text; v_revision bigint; v_seq bigint;
begin
  if p_playback_state not in ('playing','paused') then raise exception 'Invalid playback state'; end if;
  if p_position_seconds is null or p_position_seconds < 0 or p_position_seconds > 86400 then raise exception 'Invalid playback position'; end if;
  if p_playback_seq is null or p_playback_seq < 1 then raise exception 'Invalid playback sequence'; end if;
  update public.animestream_watch_rooms set
    position_seconds=p_position_seconds, playback_state=p_playback_state,
    playback_updated_at=p_playback_updated_at, media=coalesce(p_media,media),
    media_type=coalesce(p_media_type,media_type), playback_seq=p_playback_seq,
    revision=revision+1, last_activity_at=pg_catalog.now(), expires_at=pg_catalog.now()+interval '6 hours'
  where id=p_room_id and status='active' and expires_at>pg_catalog.now()
    and p_playback_seq>playback_seq and (not p_position_only or playback_state='playing')
  returning channel_topic,revision,playback_seq into v_topic,v_revision,v_seq;
  if not found then return null; end if;
  return jsonb_build_object('channel_topic',v_topic,'revision',v_revision,'playback_seq',v_seq);
end;
$$;
revoke all on function public.update_animestream_watch_room_playback(uuid,numeric,text,timestamptz,jsonb,text,boolean,bigint) from public,anon,authenticated;
grant execute on function public.update_animestream_watch_room_playback(uuid,numeric,text,timestamptz,jsonb,text,boolean,bigint) to service_role;
