# AnimeStream Watch Rooms — Pause synchronization fix

## What changed

1. `assets/js/player.js` now recognises more provider pause/play event formats: direct events, `action`/`command`, nested `data`/`value`/`payload`/`detail`/`message`, boolean state flags, string state payloads, and common numeric state-change payloads. It still forwards the normalized pause/play event into the existing room callback.
2. `assets/js/rooms.js` immediately publishes a signed `host_playback` packet when the host pause event is detected. It does not wait for the next one-second state packet or five-second database checkpoint.
3. For providers that omit an explicit pause event but continue reporting a frozen timeline, the host detects two stationary time updates and publishes Pause. If the provider stops sending time events entirely, an approximately 3-second no-progress watchdog is the fallback.
4. Guest pause application is now ordered defensively: send Pause immediately, then reapply the final seek position and Pause again after 140ms in case the provider handles seeking asynchronously. Subsequent paused-state packets reassert Pause if needed.
5. The same playback sequence numbers and signed Realtime Broadcast messages remain in use. The existing API checkpoint remains host-only and accepts `kind: "pause"`; no new database migration is needed for this client-side correction.

## Files changed

- `assets/js/player.js` — provider event normalization.
- `assets/js/rooms.js` — immediate pause propagation, frozen-timeline detection, guest pause reassertion.
- `tests/room-pause-sync.test.cjs` — parser and pause-path regression tests.
- `supabase/ROOMS_SETUP.md` — updated pause behavior and provider notes.

## Supabase handoff

The complete current Supabase source is included under `supabase/`, including the `rooms-api` Edge Function, `rooms_schema.sql`, and all room migrations. The current pause fix does not alter table shape or RPC signatures. Keep the existing `rooms-api` and schema contract when merging into the redesigned UI.

## Important provider limitation

A cross-origin iframe can only be controlled through messages the provider supports. These changes make event recognition and command reassertion more robust, but cannot force a provider that does not expose a pause command to obey one. Verify each streaming provider with two browsers after deployment.
