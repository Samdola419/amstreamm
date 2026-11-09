-- Rollback-only regression test. Run after the pause-sticky migration.
begin;
do $$
declare
  v_account uuid;
  v_room uuid;
  v_result jsonb;
  v_state text;
  v_position numeric;
  v_seq bigint;
  v_media jsonb := '{"type":"anime","title":"Sticky Pause SQL test","ani_id":12345,"episode_index":5,"source_index":1,"language":"sub"}'::jsonb;
begin
  insert into public.animestream_accounts(email,display_name,password_hash,password_salt)
  values ('sticky-pause-sql-test-'||gen_random_uuid()::text||'@example.invalid','Sticky Pause Test','test-hash','test-salt')
  returning id into v_account;

  insert into public.animestream_watch_rooms(room_code,channel_topic,host_account_id,media_type,media,playback_state,position_seconds)
  values (upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
          'watch-room-sticky-pause-test:'||gen_random_uuid()::text,
          v_account,'anime',v_media,'playing',100)
  returning id into v_room;

  v_result := public.update_animestream_watch_room_playback(v_room,101,'playing',now(),v_media,'anime',false,10,false);
  if v_result is null then raise exception 'Initial playing state was rejected'; end if;
  v_result := public.update_animestream_watch_room_playback(v_room,105,'paused',now(),v_media,'anime',false,11,false);
  if v_result is null then raise exception 'Pause packet was rejected'; end if;

  v_result := public.update_animestream_watch_room_playback(v_room,106,'playing',now(),v_media,'anime',false,12,false);
  if v_result is not null then raise exception 'Playing heartbeat resumed a paused room'; end if;
  v_result := public.update_animestream_watch_room_playback(v_room,107,'playing',now(),v_media,'anime',true,13,true);
  if v_result is not null then raise exception 'Position-only checkpoint changed a paused room'; end if;

  select playback_state,position_seconds,playback_seq into v_state,v_position,v_seq
  from public.animestream_watch_rooms where id=v_room;
  if v_state<>'paused' or v_position<>105 or v_seq<>11 then
    raise exception 'Room did not remain paused: state %, position %, sequence %',v_state,v_position,v_seq;
  end if;

  v_result := public.update_animestream_watch_room_playback(v_room,105,'playing',now(),v_media,'anime',false,14,true);
  if v_result is null then raise exception 'Explicit Play did not resume the room'; end if;
  select playback_state,playback_seq into v_state,v_seq from public.animestream_watch_rooms where id=v_room;
  if v_state<>'playing' or v_seq<>14 then raise exception 'Explicit Play failed: state %, sequence %',v_state,v_seq; end if;
  raise notice 'PASS: Pause is sticky; stale Playing heartbeats are rejected; only explicit Play resumes.';
end $$;
rollback;
