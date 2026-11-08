-- Clear the previous host signing key when host authority transfers.
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
        host_signing_public_key = null,
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

revoke all on function public.leave_animestream_watch_room(uuid, uuid) from public, anon, authenticated;
grant execute on function public.leave_animestream_watch_room(uuid, uuid) to service_role;
