# AnimeStream — cinematic, device-local streaming UI

A static multi-file streaming frontend using the existing AnimeStream catalogue integrations and playback pages. The UI is refreshed around the green-and-black brand in `logo.jpg`.

## User experience

- Cinematic home hero, trending list, and horizontally browsable movie, series, and anime shelves.
- Dedicated Movies, Series, Anime, My List, Continue Watching, title-detail, and player views.
- Trailer previews play muted in the featured banner and on desktop poster hover when a catalogue provides a YouTube trailer ID.
- Responsive mobile layout with touch-friendly controls and no hover-only information.
- Local library: saved titles, Continue Watching, watch progress where supported, and preferences are stored in this browser using `localStorage`. No accounts, login, or application database are required. Local data stays in the browser on that device and is not synchronised across devices.
- One muted video sponsor banner at the top of discovery/detail pages. No popup ad or forced mid-roll is enabled.

## Project structure

- `index.html` — app shell and page markup. The browser uses clean routes; visitors do not need to open `/index.html`.
- `assets/css/app.css` — responsive theme and layout.
- `assets/js/00-config.js` through `50-startup.js` — ordered app modules.
- `api/` — existing Vercel catalogue/image/share handlers.
- `megaplay.html`, `megaplay-worker.js` — existing player integration.
- `logo.jpg`, `favicon.svg` — brand assets.
- `vercel.json` and `_redirects` — clean-route fallback and `/index.html` redirect. `server3.js` also redirects `/index.html` and falls back to the app shell for client routes when used as a local static helper.

## Routes

- `/`
- `/movies` and `/movies/genre/:genre`
- `/series` and `/series/genre/:genre`
- `/anime` and `/anime/genre/:genre`
- `/title/:type/:id`
- `/watch/:type/:id`
- `/my-list`
- `/continue-watching`

## Deploy

Deploy the whole project directory to Vercel. Keep `api/`, `assets/`, `megaplay.html`, `megaplay-worker.js`, `logo.jpg`, `favicon.svg`, `vercel.json`, and `_redirects` in their original locations. No frontend build step is required.

The catalogue, artwork, trailer metadata, sponsor video, and stream embeds still depend on their upstream providers. Local library data is browser/device-specific and may be cleared if the browser's site data is erased.
