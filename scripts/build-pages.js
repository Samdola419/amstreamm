#!/usr/bin/env node
/**
 * Multi-page build: gives every route a REAL page so a browser reload never lands on "site not found".
 *
 *   node scripts/build-pages.js
 *
 * - /anime /movies /series /category /list /continue /coming /manga /account  -> <route>/index.html
 * - /genre/<Name>  /movies/<Genre>  /series/<Genre>                              -> real pages too
 * - 404.html is the same app shell, so deep links that cannot be pre-built (/play/..., /t/..., /room/CODE)
 *   still open the app on static hosts (GitHub Pages, Cloudflare Pages, Netlify, S3...).
 *
 * index.html stays the single source of truth. Re-run this after editing it (or its <head>), then deploy.
 * Zero dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://www.amstream.site';
const SITE = 'AnimeStream';

const shell = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Genre lists are read from the app's own source so they never drift.
function readArray(file, name) {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js', file), 'utf8');
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*(\\[[^\\]]*\\])').exec(src);
  if (!m) return [];
  try { return Function('return ' + m[1])(); } catch (_) { return []; }
}
const animeGenres = [...new Set([...readArray('catalog.js', 'CATEGORIES'), ...readArray('data.js', 'ANIME_GENRES')])];
const movieGenres = readArray('catalog.js', 'MOVIE_CATEGORIES');
const seriesGenres = readArray('catalog.js', 'SERIES_CATEGORIES');

const label = g => (g === 'Adult' || g === 'Hentai') ? '18 Plus' : g;
const pages = [
  { route: '/anime', title: 'Anime', desc: 'Browse anime by genre on AnimeStream, from current seasons to all-time favorites.' },
  { route: '/movies', title: 'Movies', desc: 'Browse movies by genre on AnimeStream.' },
  { route: '/series', title: 'Series', desc: 'Browse TV series by genre on AnimeStream.' },
  { route: '/category', title: 'Categories', desc: 'Browse every AnimeStream category.' },
  { route: '/list', title: 'My List', desc: 'Your saved titles on AnimeStream.' },
  { route: '/continue', title: 'Continue Watching', desc: 'Pick up where you left off on AnimeStream.' },
  { route: '/coming', title: 'Coming Soon', desc: 'Upcoming anime, movies and series on AnimeStream.' },
  { route: '/manga', title: 'Manga', desc: 'Read manga on AnimeStream.' },
  { route: '/account', title: 'Your account', desc: 'Your AnimeStream account, library and watch progress.' },
];
for (const g of animeGenres) pages.push({ route: '/genre/' + encodeURIComponent(g), dir: '/genre/' + g, title: label(g) + ' anime', desc: `Watch ${label(g).toLowerCase()} anime on AnimeStream.` });
for (const g of movieGenres) pages.push({ route: '/movies/' + encodeURIComponent(g), dir: '/movies/' + g, title: label(g) + ' movies', desc: `Watch ${label(g).toLowerCase()} movies on AnimeStream.` });
for (const g of seriesGenres) pages.push({ route: '/series/' + encodeURIComponent(g), dir: '/series/' + g, title: label(g) + ' series', desc: `Watch ${label(g).toLowerCase()} series on AnimeStream.` });

const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function render(p) {
  const url = ORIGIN + (p.route === '/' ? '/' : p.route);
  const title = p.route === '/' ? shell.match(/<title>([^<]*)<\/title>/)[1] : `${p.title} | ${SITE}`;
  let html = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(p.desc || '')}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(p.desc || '')}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/<link rel="canonical"[^>]*>\s*/g, '');
  return html.replace('</title>', `</title>\n  <link rel="canonical" href="${url}">`);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

let count = 0;
for (const p of pages) {
  write(path.join(ROOT, (p.dir || p.route), 'index.html'), render({ ...p, route: p.route }));
  count++;
}
// 404.html = app shell with the home metadata: GitHub Pages / Cloudflare Pages / Netlify serve it for any unknown path.
write(path.join(ROOT, '404.html'), render({ route: '/', desc: '' }).replace(/(<meta name="description" content=")[^"]*(")/, '$1Watch anime on AnimeStream. Browse trending picks, save a personal list, and continue watching.$2'));
// refresh the home page's canonical tag too
fs.writeFileSync(path.join(ROOT, 'index.html'), render({ route: '/', desc: 'Watch anime on AnimeStream. Browse trending picks, save a personal list, and continue watching.' }));
console.log(`Built ${count} route pages + 404.html from index.html`);
