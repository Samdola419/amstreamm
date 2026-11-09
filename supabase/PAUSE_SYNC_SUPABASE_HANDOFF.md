# Supabase folder handoff — Watch Rooms Pause synchronization

This folder is based on the uploaded `amss.zip`. It contains the existing Supabase setup plus the updated `rooms-api`, canonical SQL schema, migration and regression tests. It does not include or change the website UI.

## What the backend update does

- Adds `action: "sync_state"` to `functions/rooms-api/index.ts`.
- Validates the current AnimeStream custom session and active host membership.
- Verifies each P-256 ECDSA-signed host packet against the room's registered public key.
- Rejects old/duplicate playback sequence numbers.
- Writes the accepted host state through the atomic playback RPC.
- Relays the exact original signed packet to the room's Realtime topic.
- Makes Pause sticky: once paused, a periodic `host_state` packet saying `playing` is rejected. Only `host_playback` with `command: "play"` may resume.
- Allows paused `host_state` packets to update the room snapshot at the same cadence as playing packets.

## Required frontend call

The uploaded `assets/js/rooms.js` currently calls `roomChannel.send()` directly inside `roomSignAndBroadcast(payload)`. Replacing this folder does not change that browser code. To make this backend relay receive each one-second state packet, update the existing sender to keep its signature creation but replace the direct channel send with:

```js
const packet = { ...payload, signature };
const result = await roomApi('sync_state', { packet });
roomLastRevision = Math.max(roomLastRevision, Number(result.revision) || 0);
roomPlaybackSeq = Math.max(roomPlaybackSeq, Number(result.playback_seq) || payload.playback_seq);
return true;
```

Set both `ROOM_STATE_PLAYING_MS` and `ROOM_STATE_PAUSED_MS` to `1000`. Keep immediate signed `host_playback` commands for Pause/Play/Seek/Episode. Ensure the host changes its local state to `paused` before sending Pause, and subsequent `host_state` packets keep reporting `paused` until an explicit Play event.

Since `sync_state` already persists and broadcasts the packet, remove the duplicate `roomPersistPlayback()` call for that same packet and do not send a second progress checkpoint using the same sequence.

## Apply and deploy

1. Replace your project's existing `supabase/` folder with this one.
2. Apply `migrations/20261109035000_room_pause_sticky_and_signed_state_relay.sql` to the existing Supabase project after the current room sequence migration. This replaces the existing 8-argument playback RPC with the sticky-pause 9-argument RPC and preserves room data.
3. Deploy `functions/rooms-api/index.ts` as `rooms-api` with gateway JWT verification disabled. The function validates AnimeStream's custom account session itself.
4. Make the small frontend sender/cadence changes above. A Supabase folder replacement alone cannot change how frequently the browser sends state.
5. Run `tests/room_pause_sticky.sql` in a transaction-aware SQL editor and `node supabase/tests/host_packet_signature.test.cjs` locally.

The current live Supabase project is not modified by this package. No service-role secret is included.
