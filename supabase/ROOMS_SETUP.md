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

- `rooms_schema.sql` creates the room, member, and chat tables, the atomic four-seat join function, and the atomic room revision function.
- `functions/rooms-api/index.ts` is the server-side API. It validates the custom account session and membership before all room reads, writes, chat, and playback commands.
- Deploy `rooms-api` with gateway JWT verification disabled because it validates AnimeStream's custom bearer session itself. The publishable API key is still sent by the browser. The service-role key remains in the Edge Function environment only.

## Live updates

The browser subscribes to a public Realtime topic containing a random 192-bit opaque room token returned only to room members. Broadcast messages contain only harmless change notifications (revision and event kind), never chat text or playback state. After a notification, the client re-fetches room state through `rooms-api`, which checks the signed-in account and membership. Seven-second polling remains as a fallback if Realtime is unavailable. No Realtime RLS policy or dashboard switch is required for this notification-only channel design.

## Player compatibility

The host's player sends small control instructions through the local MegaPlay wrapper. The wrapper forwards them to the inner provider iframe and queues a command until the provider starts communicating. A provider must expose a compatible `postMessage` player API for remote play/pause/seek to work. Providers that ignore those commands still work for room membership, shared title/episode selection where available, and chat; full playback sync is not guaranteed for every external source.
