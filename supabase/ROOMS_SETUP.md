# AnimeStream Watch Rooms

Watch Rooms use the existing AnimeStream custom account sessions and the current Supabase project. No Supabase Auth or additional provider is used.

## Behaviour

- Four people maximum per room, including the host.
- Eight-character invite code and `/room/CODE` link.
- Host can send play, pause, seek, and episode-change controls.
- Each participant streams the title independently through their normal AnimeStream player.
- Room chat is stored in Postgres (500-character messages; per-user rate limit; last 500 messages retained, last 60 returned to the client).
- Room presence is maintained with a heartbeat. Abandoned rooms expire after six hours without activity; old rows are removed lazily when a new room is created.
- A host can end a room; if a host leaves, the oldest active participant becomes host. A stale host is replaced when a new member joins.

## Database and functions

- `rooms_schema.sql` creates the room, member, and chat tables, atomic four-seat join, revision, playback, leave, and end functions, plus lookup indexes.
- `functions/rooms-api/index.ts` is the server-side API. This folder contains the source update for the new `sync_state` action; it must be deployed after applying the included migration. It validates the custom account session and membership before all room reads, writes, chat, and playback commands.
- Deploy `rooms-api` with gateway JWT verification disabled because it validates AnimeStream's custom bearer session itself. The publishable API key is still sent by the browser. The service-role key remains in the Edge Function environment only.

## Live updates

The browser subscribes to a public Realtime topic containing a random 192-bit opaque room token returned only after server-side membership validation. Chat and membership events are broadcast by the Edge Function. Host playback packets are submitted to the `sync_state` action, which validates the custom account session, active host membership, P-256 ECDSA signature and increasing sequence; writes the authoritative playback snapshot; and relays the exact signed packet to the same Realtime topic. Guests continue to verify the original host signature before applying a packet.

Pause is sticky in the database: once a room is paused, a periodic `host_state` packet that claims `playing` is rejected. Only an explicit signed `host_playback` packet with `command: "play"` can resume the room. Paused host-state packets are accepted and saved at the same cadence as playing packets. The frontend must send these packets once per second in both states. Playback state packets remain transient Realtime messages, not chat rows. Do not send a second checkpoint for the same sequence. Full snapshots and heartbeat/polling remain available for reconnect recovery.

## Player compatibility

The host's player sends small control instructions through the local MegaPlay wrapper. The wrapper forwards them to the inner provider iframe and queues a command until the provider starts communicating. A provider must expose compatible playback events and a `postMessage` player API for remote play/pause/seek to work. While in a room, guest iframe pointer input, keyboard tab focus, and fullscreen permission are disabled, and the API rejects guest playback-control requests; the host uses the ordinary player controls. Providers that ignore playback commands still work for room membership, shared title/episode selection where available, and chat; full playback sync is not guaranteed for every external source.


## Room deletion and leaving

`leave_animestream_watch_room` marks the departing member as left and rotates the topic. If the host leaves, the oldest remaining member becomes host. If no members remain, the room row is physically deleted. `end_animestream_watch_room` is host-only and physically deletes the room. The foreign-key `ON DELETE CASCADE` rules remove the room code row, member rows, and messages in the same transaction. The browser stays on the currently open show when a member leaves or a room ends. The room code is physically removed when the host ends the room or the last member leaves; foreign-key cascades remove the associated member and message rows.


## Host state stream

The active host keeps a P-256 ECDSA signing key in the browser tab's session storage. The public key is stored on the room row. While connected to the room's Supabase Realtime Broadcast channel, the host sends a signed state packet every second while playing and every 2.5 seconds while paused. Packets contain the current media identity, source index/name, language, episode/season, position, play state, playback rate, timestamp, and a strictly increasing host sequence. Playback packets are transient Broadcast events, not chat rows. Guests verify the signature and sequence before applying them. The same WebSocket channel carries chat and playback events, but chat is persisted separately through the authenticated Rooms API.

The host's ordinary AnimeStream player remains authoritative. Guests have a player interaction shield and a local-only volume slider; volume messages are sent only to that guest's local embedded player and are never broadcast to other members. Some external providers do not expose a volume API, so device-level volume remains the fallback. On phones the room is a stacked layout: the video keeps its 16:9 shape at the top, a slim room bar sits under it (tap it for the invite code, people, volume and leave/end), and the chat and composer fill the rest of the screen above the keyboard. The room UI lives in `assets/js/rooms-ui.js` and the room block of `assets/css/site.css`; `assets/js/rooms.js` still owns the API, Realtime and playback sync.


## Pause delivery and provider compatibility

The host player must update its local playback flag to `paused` immediately when the provider reports Pause, then submit a signed `host_playback` packet with `command: "pause"`. Every following one-second `host_state` packet must continue reporting `paused` until explicit Play. The `sync_state` Edge Function verifies each packet, persists the ordered state, and relays it to connected guests. Guests verify the host signature and sequence before applying it.

A cross-origin provider must still support the underlying pause command. Supabase guarantees host validation, sticky state, sequence ordering and relay; it cannot force an external iframe to obey a command the provider does not expose. See `PAUSE_SYNC_SUPABASE_HANDOFF.md` for the required browser sender hookup.