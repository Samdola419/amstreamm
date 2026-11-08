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
- `functions/rooms-api/index.ts` is the server-side API. It validates the custom account session and membership before all room reads, writes, chat, and playback commands.
- Deploy `rooms-api` with gateway JWT verification disabled because it validates AnimeStream's custom bearer session itself. The publishable API key is still sent by the browser. The service-role key remains in the Edge Function environment only.

## Live updates

The browser subscribes to a public Realtime topic containing a random 192-bit opaque room token returned only after server-side membership validation. The Edge Function broadcasts the actual chat message and host playback command/position payload, so connected clients apply them immediately without a second API fetch. Every playback write carries a strictly increasing host playback sequence and the database atomically rejects older commands or position pulses, even if the network delivers them out of order. Position pulses are accepted only while the room is still playing, and clients also discard older event revisions. The host publishes position updates every three seconds; these progress pulses never queue ahead of a Play, Pause or Seek command. If a provider emits time updates but omits an explicit pause event, the host client infers a pause after six seconds without playback progress. Full snapshots are fetched when Realtime reconnects and on a 12-second heartbeat; 1.5-second API polling is enabled only while Realtime is disconnected. A topic is rotated when someone leaves. No Supabase Auth conversion or external provider is required.

## Player compatibility

The host's player sends small control instructions through the local MegaPlay wrapper. The wrapper forwards them to the inner provider iframe and queues a command until the provider starts communicating. A provider must expose compatible playback events and a `postMessage` player API for remote play/pause/seek to work. While in a room, guest iframe pointer input, keyboard tab focus, and fullscreen permission are disabled, and the API rejects guest playback-control requests; the host uses the ordinary player controls. Providers that ignore playback commands still work for room membership, shared title/episode selection where available, and chat; full playback sync is not guaranteed for every external source.


## Room deletion and leaving

`leave_animestream_watch_room` marks the departing member as left and rotates the topic. If the host leaves, the oldest remaining member becomes host. If no members remain, the room row is physically deleted. `end_animestream_watch_room` is host-only and physically deletes the room. The foreign-key `ON DELETE CASCADE` rules remove the room code row, member rows, and messages in the same transaction. The browser stays on the currently open show when a member leaves or a room ends. The room code is physically removed when the host ends the room or the last member leaves; foreign-key cascades remove the associated member and message rows.
