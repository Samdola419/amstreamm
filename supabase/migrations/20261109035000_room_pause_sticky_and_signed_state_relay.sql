-- Upgrade Watch Rooms playback checkpoints to enforce sticky Pause.
-- Existing rooms and playback sequence values are preserved.
alter table public.animestream_watch_rooms
  add column if not exists playback_seq bigint not null default 0;
alter table public.animestream_watch_rooms
  add column if not exists host_signing_public_key text;

-- Atomic playback snapshot + revision. Pause remains authoritative until explicit Play.
drop function if exists public.update_animestream_watch_room_playback(uuid,numeric,text,timestamptz,jsonb,text,boolean,bigint);
drop function if exists public.update_animestream_watch_room_playback(uuid,numeric,text,timestamptz,jsonb,text,boolean,bigint,boolean);

create or replace function public.update_animestream_watch_room_playback(
  p_room_id uuid,
  p_position_seconds numeric,
  p_playback_state text,
  p_playback_updated_at timestamptz,
  p_media jsonb,
  p_media_type text,
  p_position_only boolean,
  p_playback_seq bigint,
  p_allow_resume boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_topic text; v_revision bigint; v_seq bigint;
begin
  if p_playback_state not in ('playing','paused') then raise exception 'Invalid playback state'; end if;
  if p_position_seconds is null or p_position_seconds < 0 or p_position_seconds > 86400 then raise exception 'Invalid playback position'; end if;
  if p_playback_seq is null or p_playback_seq < 1 then raise exception 'Invalid playback sequence'; end if;
  update public.animestream_watch_rooms set
    position_seconds=p_position_seconds,
    playback_state=p_playback_state,
    playback_updated_at=p_playback_updated_at,
    media=coalesce(p_media,media),
    media_type=coalesce(p_media_type,media_type),
    playback_seq=p_playback_seq,
    revision=revision+1,
    last_activity_at=pg_catalog.now(),
    expires_at=pg_catalog.now()+interval '6 hours'
  where id=p_room_id and status='active' and expires_at>pg_catalog.now()
    and p_playback_seq>playback_seq
    -- A position-only checkpoint never changes a paused room to playing.
    and (not p_position_only or (playback_state='playing' and p_playback_state='playing'))
    -- Only an explicit Play command may transition paused -> playing.
    and (playback_state<>'paused' or p_playback_state<>'playing' or coalesce(p_allow_resume,false))
  returning channel_topic,revision,playback_seq into v_topic,v_revision,v_seq;
  if not found then return null; end if;
  return jsonb_build_object('channel_topic',v_topic,'revision',v_revision,'playback_seq',v_seq);
end;
$$;
revoke all on function public.update_animestream_watch_room_playback(uuid,numeric,text,timestamptz,jsonb,text,boolean,bigint,boolean) from public,anon,authenticated;
grant execute on function public.update_animestream_watch_room_playback(uuid,numeric,text,timestamptz,jsonb,text,boolean,bigint,boolean) to service_role;
