# MegaPlay shield on Cloudflare (free) — step by step

## Why
The shield mirrors MegaPlay's page and pipes their video through a proxy. If that proxy ran on
Vercel, every episode would funnel bytes through your Vercel functions and burn the free plan
(your current usage: CDN Requests 488K/1M, Fast Origin Transfer 4.26GB/10GB — the video relay
alone would eat that). Cloudflare Workers is free and built for exactly this kind of relay:
- 100,000 requests/day (an episode uses roughly 700–1,500 — a heavy evening is a few thousand)
- no bandwidth charge, and relaying bytes costs almost zero CPU
- Vercel stops seeing any of it: your Fast Origin Transfer stays flat

Movies/series/cartoons never touch the worker — their shield is pure sandbox blocking.

## Setup (one time, ~3 minutes)
1. Go to https://dash.cloudflare.com and create a free account (email + password is enough).
2. In the left sidebar click **Workers & Pages** → **Create** → **Create Worker**.
3. Name it something like `mp-shield` and click **Deploy** (it deploys a hello-world first).
4. Click **Edit code**. Delete everything in the editor and paste the entire contents of
   `megaplay-worker.js` (this file sits next to this guide). Click **Deploy**.
5. At the top of the editor you'll see your worker URL, like:
   `https://mp-shield.YOURNAME.workers.dev` — copy it.

## Wire it into the site
6. Open `megaplay.html` and find this line (near the top of the script):
   ```js
   const WORKER_BASE = '/mgpx';
   ```
   Replace it with:
   ```js
   const WORKER_BASE = 'https://mp-shield.YOURNAME.workers.dev/mgpx';
   ```
   (that's one line; add `/mgpx` at the end — it must match the paths the worker serves)
7. Redeploy your site to Vercel like you normally do.

## Test
- Open an anime episode on the live site. Video should play, Skip Intro should appear during
  openings, no popup tab should ever appear.
- Movies/series: those load straight from their servers with the sandbox shield — nothing goes
  through the worker.

## If MegaPlay ever breaks it (their domains rotate now and then)
Re-paste `megaplay-worker.js` into your worker and redeploy. If their whole embed stops, I'll
update the worker file — nothing else changes.

## Optional (not needed)
A custom subdomain (`mp.amstream.site`) is possible but requires pointing your domain's DNS at
Cloudflare. The free `workers.dev` URL works fine and keeps your DNS untouched.
