# Watch Rooms redesign: notes for merging

Files changed: `index.html` (room markup, dialogs, one Back button), `assets/css/site.css` (the room block at the end replaces the old
room rules; account-page rules were kept as-is), `assets/js/rooms-ui.js` (new), `supabase/ROOMS_SETUP.md` (docs only).

Unchanged on purpose: `assets/js/rooms.js`, `assets/js/player.js`, everything under `supabase/` except the docs file, `megaplay.html`.

`rooms-ui.js` loads after `rooms.js` and replaces only rooms.js's presentation functions, keeping their names:
`roomRenderMembers`, `roomRenderMessages`, `roomAppendMessage`, `roomSendMessage`, `roomSetPanel`, `roomPlacePanel`.
Anything inside rooms.js (API, Realtime, host signing, sync, pause handling) can be replaced with a newer version
(for example the pause-sync fix described in ROOMS_PAUSE_SYNC_FIX.md) without touching the UI, as long as those function names still exist.

IDs that rooms.js reads/writes are preserved: roomPanel, roomConnection, roomMemberCount, roomMemberList, roomCode, roomPlaybackStatus,
roomEndButton, roomLocalVolumeControl/Range/Value, roomPlayerLock, roomChatMessages, roomChatInput, createRoomButton.

New helpers exposed for inline handlers: roomToggleDetails, roomRequestLeave, roomRequestEnd, roomAwareBack, roomCloseLeaveModal,
roomConfirmLeave, roomScrollToLatest, roomFormatJoinInput.

## Round 2 (player controls, mobile spacing, multi-page)
- `index.html`: `.player-info` is now `.player-head` (title + Watch together) and `.player-controls` (labelled rows). All IDs are unchanged.
- `assets/css/site.css`: new "Player: title row + organised control rows" and "Poster rows and mobile rhythm" blocks at the end.
- `assets/js/router.js`, `assets/js/ui.js`: per-route document titles (`syncDocTitle`). No routing logic changed.
- New: `scripts/build-pages.js`, generated `<section>/index.html`, `404.html`, `_redirects`, `.htaccess`, `serve.json`, `.nojekyll`, `DEPLOY.md`. `vercel.json` rewrites rewritten in plain `:path*` form.
