# Deploying AnimeStream (multi-page)

Every section is a real page, so reloading, bookmarking or sharing a URL always works:

| URL | Served from |
| --- | --- |
| `/`, `/anime`, `/movies`, `/series`, `/category`, `/manga`, `/coming`, `/list`, `/continue`, `/account` | a real file (`index.html` or `<section>/index.html`) with its own title and meta tags |
| `/movies/Action`, `/series/Drama`, `/genre/...`, `/play/...`, `/t/...`, `/room/CODE` | the app shell: via the rules below, or `404.html` on hosts that have no rules |

The app reads `location.pathname` on load (`assets/js/router.js`), so any of these URLs opens the right screen after a reload.

## Hosts
- **Vercel**: nothing to do. `vercel.json` has the rewrites and cache headers; `cleanUrls` is on.
- **Netlify / Cloudflare Pages**: `_redirects` is included.
- **GitHub Pages**: works as-is. `404.html` is the fallback shell and `.nojekyll` is included.
- **Apache / shared hosting**: `.htaccess` is included (needs `mod_rewrite`).
- **nginx**: `location / { try_files $uri $uri/ /index.html; }`
- **Local**: `npx serve .` (uses `serve.json`) or `node server3.js`.

## Changing pages
`index.html` is the single source. After editing it (or adding a section), regenerate the page files:

    node scripts/build-pages.js

To add a section, add it to `PAGES` in `scripts/build-pages.js` and to `routeFor` / `routerBoot` in `assets/js/router.js`.
The `/api/*` functions still need a host that runs them (Vercel does).
