# AnimeStream — refined emerald streaming UI

A refined multi-screen AnimeStream frontend that keeps the existing charcoal-and-emerald brand colors and streaming/API integrations.

## Screens and interactions

- Home with feature artwork pulled from live catalog sources, a trending list, and horizontal rows.
- Dedicated Movies, Series, and Anime collection pages with a full-bleed image drawn from catalog artwork, genre chips, catalog count, sorting, and a surprise-pick action.
- Search across anime, series, and movies.
- Title detail screens with remote poster/backdrop artwork, metadata, descriptions, Play, Share, and My List.
- Player screen with the existing providers, server options, and episode selection.
- My List and Continue Watching, saved to local storage in the current browser.
- Responsive desktop/mobile layout with a consistent icon font and unified Back controls.

## Artwork and icons

The generated fallback banner has been removed. Artwork is loaded from the existing public data sources: AniList banner/cover images, TVmaze show artwork, and the existing Metahub poster/backdrop endpoints used by the current catalogs. Remix Icon is loaded from its version-pinned CDN stylesheet for consistent icons; no hand-written inline SVG icon set is used.

## Advertising

Both original placements using A-Ads unit `2457991` are preserved as separate iframes:

- A popup displayed on initial page load, with Close and Continue actions.
- A compact, persistent sponsored dock that stays visible on every in-app page, including Home, Movies, Series, Anime, details, player, My List, and Continue Watching.

The popup is dismissed when Continue is selected; the persistent sponsor dock remains visible separately. The old homepage-only slot is not used.

## Deploy

Deploy this `anime-vercel` directory using the existing Vercel setup. Keep the `/api` directory, `megaplay.html`, `logo.jpg`, and `favicon.jpg` in their original locations. No framework build step is required.

## Validation

- Both inline JavaScript blocks passed `node --check`.
- Confirmed exactly two iframe placements use A-Ads unit `2457991`.
- Confirmed the page uses external catalog artwork rather than the prior generated banner.
- The full site still needs production smoke testing for live APIs, ad delivery, and stream playback after deployment.


## UI refinement v4

- Anime, Movies, and Series landing pages use home-style horizontal genre shelves, with View All opening a focused category grid.
- New Movies now falls back to existing Cinemeta catalogs when the primary movie feed is unavailable or empty, sorting fallback results by release year.
- Search opens with existing catalog titles and popular suggestions; category tabs have been removed and live search spans anime, series, and movies.
- A-Ads placement 2457991 remains in the initial popup and a separate sponsored card within the Home feed. The in-feed card scrolls naturally and is not fixed across every page.
- The top navigation uses a translucent liquid-glass treatment and hides on downward scroll, reappearing when scrolling up, near the top edge, or while search/profile UI is active.
- Catalog artwork is loaded from existing online catalog endpoints; no generated banner is bundled.

Deployment note: external catalog availability and ad rendering depend on their upstream services. Test playback and A-Ads rendering after deploying.


Latest UI refinement: Anime and Series landing heroes now choose real artwork from their own catalogs; poster rendering retries alternate catalog artwork sources before using a title placeholder. The in-feed A-Ads unit is a single reusable section moved into the active page slot (Home, Browse, Title Details, Player, My List, or Continue Watching), while the separate popup remains its own placement. It is not fixed or overlaid on video controls.
