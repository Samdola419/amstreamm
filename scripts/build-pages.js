#!/usr/bin/env node
// Generates the real multi-page structure from index.html (the single source of truth).
//
//   node scripts/build-pages.js
//
// What it writes (all safe to regenerate, never edit these by hand):
//   <section>/index.html   a real file for every fixed section (/movies, /series, /anime, ...), each with its own
//                          <title>, description and Open Graph tags, so a reload or a shared link always works.
//   404.html               the same app shell. Static hosts (GitHub Pages, Netlify, Cloudflare Pages, Vercel, S3...)
//                          serve it for any URL without a file, which is what makes deep links such as
//                          /play/movie/tt0245429/129/spirited-away or /room/K7QX9M2A work after a reload.
//   _redirects             Netlify / Cloudflare Pages rules for the dynamic routes.
//   .htaccess              Apache rules.
//   serve.json             rules for `npx serve`.
// vercel.json is hand-maintained (it also carries cache headers) and is only checked here.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://www.amstream.site';
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Fixed sections: real directories with their own metadata.
const PAGES = [
  { dir: 'anime',    title: 'Anime | AnimeStream',               desc: 'Browse trending, popular and seasonal anime. Watch sub or dub, save a list and pick up where you left off.' },
  { dir: 'movies',   title: 'Movies | AnimeStream',              desc: 'New and popular movies by genre. Watch together with friends in a shared room.' },
  { dir: 'series',   title: 'Series | AnimeStream',              desc: 'Trending TV series and shows. Track your progress and jump to the next episode.' },
  { dir: 'category', title: 'Categories | AnimeStream',          desc: 'Browse AnimeStream by category and genre.' },
  { dir: 'manga',    title: 'Manga & Comics | AnimeStream',      desc: 'Read manga and comics online with a clean reader that remembers your place.' },
  { dir: 'coming',   title: 'Coming Soon | AnimeStream',         desc: 'Upcoming anime and releases with airing dates.' },
  { dir: 'list',     title: 'My List | AnimeStream',             desc: 'Your saved anime, movies and series.' },
  { dir: 'continue', title: 'Continue Watching | AnimeStream',   desc: 'Pick up where you left off.' },
  { dir: 'account',  title: 'My Account | AnimeStream',          desc: 'Manage your AnimeStream account and library sync.' }
];

// Dynamic routes the app resolves itself from location.pathname (see assets/js/router.js).
const DYNAMIC = ['play', 't', 'genre', 'room', 'movies', 'series', 'category', 'anime'];

function stamp(html, { title, desc, url, noindex }) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  let out = html;
  const swap = (re, to, label) => { if (!re.test(out)) throw new Error('index.html is missing: ' + label); out = out.replace(re, to); };
  swap(/<title>[^<]*<\/title>/, `<title>${esc(title).replace(/&amp;/g, '&amp;')}</title>`, '<title>');
  swap(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`, 'meta description');
  swap(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`, 'og:title');
  swap(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`, 'og:description');
  swap(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(url)}">`, 'og:url');
  // canonical + optional noindex go right after the title
  const extra = `\n  <link rel="canonical" href="${esc(url)}">` + (noindex ? '\n  <meta name="robots" content="noindex">' : '');
  out = out.replace(/(<title>[^<]*<\/title>)/, `$1${extra}`);
  return out;
}

function write(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log('wrote', rel);
}

// 1) real section pages
for (const p of PAGES) {
  write(`${p.dir}/index.html`, stamp(source, { title: p.title, desc: p.desc, url: `${SITE}/${p.dir}` }));
}

// 2) fallback shell for every other deep link (also what a host serves for a genuinely unknown URL)
write('404.html', stamp(source, { title: 'AnimeStream', desc: 'Watch anime, movies and series on AnimeStream.', url: SITE + '/', noindex: true }));

// 3) host rules
const rules = DYNAMIC.map(d => `/${d}/*  /index.html  200`).join('\n');
write('_redirects', `# Netlify / Cloudflare Pages. Real files (e.g. movies/index.html) win over these rules.\n${rules}\n`);

write('.htaccess', `# Apache. Real files and folders are served as-is; app routes fall back to the shell.
Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]
RewriteRule ^(${DYNAMIC.concat(PAGES.map(p => p.dir)).filter((v, i, a) => a.indexOf(v) === i).join('|')})(/.*)?$ /index.html [L]
ErrorDocument 404 /404.html
`);

write('serve.json', JSON.stringify({
  cleanUrls: true,
  rewrites: DYNAMIC.map(d => ({ source: `/${d}/**`, destination: '/index.html' }))
}, null, 2) + '\n');

// 4) sanity check vercel.json covers the same dynamic routes
try {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const sources = (vercel.rewrites || []).map(r => r.source).join(' ');
  const missing = DYNAMIC.filter(d => !sources.includes(`/${d}/`));
  if (missing.length) console.warn('WARNING: vercel.json has no rewrite for:', missing.join(', '));
} catch (e) { console.warn('could not read vercel.json:', e.message); }
