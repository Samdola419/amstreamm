# AnimeStream Watch Rooms — Claude Supabase handoff

This ZIP contains the complete current Watch Rooms implementation and the matching Supabase source. The live `rooms-api` Edge Function is deployed as version 13. Use it as the reference for merging Rooms backend pieces into the newly redesigned AnimeStream UI.

## Supabase files to carry into the redesigned project

- `supabase/functions/rooms-api/index.ts` — current Edge Function source (`rooms-api`).
- `supabase/rooms_schema.sql` — complete Watch Rooms database schema and functions.
- `supabase/migrations/20261108030000_room_host_signing_key.sql` — host public signing key column.
- `supabase/migrations/20261108031500_reset_room_signing_key_on_host_handoff.sql` — clears the previous host signing key during host transfer.
- `supabase/migrations/20261108033000_room_playback_sequence.sql` — atomic playback sequence and stale-update protection.
- `supabase/ROOMS_SETUP.md` — current architecture and deployment notes.

The SQL objects and migrations in this handoff are already present in the connected AnimeStream Supabase project. Do not blindly re-run these migrations against that same project; inspect the existing schema first. Keep the current custom-account session validation and the existing room API contract. Do not replace it with Supabase Auth. Preserve the `create_room`, `join_room`, `get_room`, `heartbeat`, `send_message`, `control`, `progress`, `set_host_signing_key`, `leave_room`, and `end_room` actions.

## Pause fix in this package

The current pause fix is primarily client-side. The live `rooms-api` v13 already accepts host-only `pause` controls, persists them through the sequence-checked RPC, and no longer sends a redundant unsigned playback echo after the host has broadcast its signed packet. `assets/js/player.js` now recognises more provider pause event shapes; `assets/js/rooms.js` broadcasts explicit host Pause immediately, detects providers that omit pause events, and applies/reasserts pause on guests. The existing Supabase API already accepts a host-authorised `control` request with `kind: "pause"` and a strictly increasing `playback_seq`; no additional database migration is required for this pause fix.

Claude should carry over the matching `supabase/` folder and preserve the frontend contract. Do not overwrite the redesigned UI with the UI files from this reference ZIP. Merge the room API, schema, and migrations into the redesigned UI project, then map its room controls/chat/player events to the same API and Realtime contract.

## Important constraints

- Host playback authority remains server-validated for database checkpoints and cryptographically signed for direct Realtime playback events.
- Playback packets are transient Broadcast events, not persistent chat rows.
- Chat messages remain persisted by `send_message`.
- Guests cannot issue playback-control requests; local volume remains local to each guest.
- Room capacity remains four people including the host.
- Room delete/leave and host-handoff behaviour must remain intact.
- Test host messaging, pause/resume, guest catch-up, and room deletion after merging.
