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
- `functions/rooms-api/index.ts` is the server-side API (currently deployed as Edge Function version 13). It validates the custom account session and membership before all room reads, writes, chat, and playback commands.
- Deploy `rooms-api` with gateway JWT verification disabled because it validates AnimeStream's custom bearer session itself. The publishable API key is still sent by the browser. The service-role key remains in the Edge Function environment only.

## Live updates

The browser subscribes to a public Realtime topic containing a random 192-bit opaque room token returned only after server-side membership validation. The Edge Function broadcasts persisted chat and membership events on that channel. The host browser sends signed playback-state and immediate play/pause/seek/episode events directly over the already-open Realtime Broadcast WebSocket, so connected guests do not wait for a follow-up HTTP fetch. When a member joins, the host immediately broadcasts a fresh full state packet instead of making the newcomer wait for the next interval. Every playback event carries a strictly increasing host sequence; guests verify its ECDSA signature and reject old or duplicate sequences. Durable playback checkpoints are written every five seconds for recovery, while the live one-second packets remain transient and are not chat rows. If a provider omits an explicit pause event, the host client detects repeated stationary time updates or falls back to an approximately 3-second no-progress watchdog. Explicit pause events are broadcast immediately; guest players reassert pause after applying the final seek position. Full snapshots are fetched when Realtime reconnects and on a 12-second heartbeat; 1.5-second API polling is enabled only while Realtime is disconnected. A topic is rotated when someone leaves. No Supabase Auth conversion or external provider is required.

## Player compatibility

The host's player sends small control instructions through the local MegaPlay wrapper. The wrapper forwards them to the inner provider iframe and queues a command until the provider starts communicating. A provider must expose compatible playback events and a `postMessage` player API for remote play/pause/seek to work. While in a room, guest iframe pointer input, keyboard tab focus, and fullscreen permission are disabled, and the API rejects guest playback-control requests; the host uses the ordinary player controls. Providers that ignore playback commands still work for room membership, shared title/episode selection where available, and chat; full playback sync is not guaranteed for every external source.


## Room deletion and leaving

`leave_animestream_watch_room` marks the departing member as left and rotates the topic. If the host leaves, the oldest remaining member becomes host. If no members remain, the room row is physically deleted. `end_animestream_watch_room` is host-only and physically deletes the room. The foreign-key `ON DELETE CASCADE` rules remove the room code row, member rows, and messages in the same transaction. The browser stays on the currently open show when a member leaves or a room ends. The room code is physically removed when the host ends the room or the last member leaves; foreign-key cascades remove the associated member and message rows.


## Host state stream

The active host keeps a P-256 ECDSA signing key in the browser tab's session storage. The public key is stored on the room row. While connected to the room's Supabase Realtime Broadcast channel, the host sends a signed state packet every second while playing and every 2.5 seconds while paused. Packets contain the current media identity, source index/name, language, episode/season, position, play state, playback rate, timestamp, and a strictly increasing host sequence. Playback packets are transient Broadcast events, not chat rows. Guests verify the signature and sequence before applying them. The same WebSocket channel carries chat and playback events, but chat is persisted separately through the authenticated Rooms API.

The host's ordinary AnimeStream player remains authoritative. Guests have a player interaction shield and a local-only volume slider; volume messages are sent only to that guest's local embedded player and are never broadcast to other members. Some external providers do not expose a volume API, so device-level volume remains the fallback. Mobile room chat is positioned as an overlay on a taller video stage, with comments flowing over the lower video area and the composer anchored at the bottom.


## Pause delivery and provider compatibility

The host's player bridge recognizes common provider pause/play envelopes (`event`, `action`, nested `data`/`payload`/`detail`, boolean playing/paused flags, and common numeric state-change messages). On a pause event, the host immediately publishes a signed `host_playback` event with `command: "pause"` over the existing room Broadcast channel and independently writes a sequenced database checkpoint. The host does not wait for the next one-second state packet. `rooms-api` v13 stores the signed command checkpoint but does not send a duplicate unsigned playback echo.

Guests apply pause before seeking to the final timestamp, then reassert pause after the seek settles. Paused-state heartbeats also reassert pause if a provider ignores the first command. Where a provider omits pause events, repeated stationary time updates are detected; a 2.8-second no-progress watchdog is the final fallback. This improves the client-side pause path, but a cross-origin provider must still support pause messages for remote pause to work.
