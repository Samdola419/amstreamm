# Pages and reloading

Every screen has a real URL and a real page, so reloading never shows "site not found".

| URL | File served |
| --- | --- |
| `/`, `/anime`, `/movies`, `/series`, `/category`, `/list`, `/continue`, `/coming`, `/manga`, `/account` | `index.html` / `<route>/index.html` |
| `/genre/<Name>`, `/movies/<Genre>`, `/series/<Genre>` | `<route>/index.html` (pre-built) |
| `/privacy-policy`, `/terms-of-service` | their own folders |
| `/play/...`, `/t/...`, `/room/CODE` (titles, players, rooms: too many to pre-build) | the app shell, via the fallback below |

The fallback is configured for every common host, so use whichever you deploy to:

- **Vercel**: `vercel.json` (rewrites everything that is not a file or `/api` to the app).
- **Netlify / Cloudflare Pages**: `_redirects`.
- **GitHub Pages and other static hosts**: `404.html` is the app shell, `.nojekyll` is included.
- **Local**: `node server.js` (or `npm start`).

The app reads `location.pathname` on load (`assets/js/router.js`) and opens the right screen.

After editing `index.html`, run `node scripts/build-pages.js` to refresh all route pages and `404.html`.
Assets are loaded from `/assets/...`, so deploy at the root of a domain (for example `www.amstream.site`).
