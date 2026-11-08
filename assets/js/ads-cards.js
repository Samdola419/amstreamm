// ---- In-feed sponsored cards ----
// One sponsored video card inside each content rail (same card shape as a movie),
// instead of a top strip: it feels like content, never like banner fireworks.
// A single shared VAST creative plays on every rail card; videos only stream
// while the card is visible, and the click-through + impression trackers stay intact.
'use strict';

let adCreative = null, adCreativeJob = null, adSeen = false;
const adExcludedRows = ['continueRow']; // personal space stays ad-free; everything else can carry ads
const AD_CACHE_KEY = 'animestream.ad.v2';
const AD_CACHE_TTL = 10 * 60 * 1000; // a reload within 10 minutes reuses the resolved creative

function ensureAdCreative() {
  if (adCreative) return Promise.resolve(adCreative);
  if (!adCreativeJob) {
    // Fast path: the resolved creative from a recent visit is reused, so cards
    // fill on this paint instead of waiting on a fresh VAST round-trip.
    try {
      const raw = JSON.parse(sessionStorage.getItem(AD_CACHE_KEY) || 'null');
      if (raw && raw.raw && raw.exp > Date.now() && raw.creative && raw.creative.media && raw.creative.media.url) {
        adCreative = raw.creative;
        if (raw.trackers) { vastAdTrackers = raw.trackers; try { vastTrackedEvents = new Set(); } catch (_) {} }
        return Promise.resolve(adCreative);
      }
    } catch (_) {}
    adCreativeJob = fetchVastCreative(VAST_TAG_URL + (VAST_TAG_URL.includes('?') ? '&' : '?') + 'cb=' + Date.now())
      .then(ad => {
        adCreative = ad && ad.media && ad.media.url ? ad : null;
        if (adCreative && ad.trackers) { vastAdTrackers = ad.trackers; try { vastTrackedEvents = new Set(); } catch (_) {} }
        else adCreative = null;
        if (adCreative) {
          try { sessionStorage.setItem(AD_CACHE_KEY, JSON.stringify({ exp: Date.now() + AD_CACHE_TTL, creative: adCreative, trackers: vastAdTrackers || null })); } catch (_) {}
        }
        return adCreative;
      })
      .catch(() => { adCreativeJob = null; return null; });
  }
  return adCreativeJob;
}

function buildAdCard() {
  const el = document.createElement('div');
  el.className = 'card ad-card';
  el.innerHTML =
    `<div class="card-poster">
      <video muted loop playsinline preload="none"></video>
      <div class="ad-card-ph"><i class="ri-clapperboard-line" aria-hidden="true"></i><span>Sponsored video</span></div>
      <span class="card-type ad">Sponsored</span>
      <a class="ad-card-link" target="_blank" rel="noopener noreferrer nofollow sponsored" aria-label="Visit advertiser"></a>
      <span class="ad-card-tag"><i class="ri-megaphone-line" aria-hidden="true"></i> Ad</span>
    </div>
    <div class="card-title">Advertisement</div>
    <div class="card-sub">Supports AnimeStream</div>`;
  const v = el.querySelector('video');
  const src = vastResolveUrl(VAST_TAG_URL, adCreative.media.url);
  v.dataset.adSrc = src;
  v.src = src;
  v.muted = true; v.defaultMuted = true; v.playsInline = true;
  v.addEventListener('playing', () => { el.classList.add('live'); }, { once: true });
  v.addEventListener('timeupdate', () => { if (v.currentTime > 0.2) el.classList.add('live'); }, { once: true });
  // A dead creative must not leave a black hole in the rail: revert to the placeholder
  // and let the shared retry loop refresh the creative for the next decoration pass.
  v.addEventListener('error', () => {
    el.classList.remove('live');
    v.removeAttribute('src');
    delete v.dataset.adSrc;
    adCreative = null;
    adCreativeJob = null;
    try { sessionStorage.removeItem(AD_CACHE_KEY); } catch (_) {}
  });
  const a = el.querySelector('.ad-card-link');
  if (adCreative.click) a.href = adCreative.click; else a.removeAttribute('href');
  return el;
}

const adCardWatch = new Set(); // { el } — cards reviewed on scroll + by IntersectionObserver

// Every visible sponsored card plays. The old single-active rule kept all but one card
// frozen on their placeholder, which read as "this rail's ad didn't load" — now each
// visible rail streams its own muted ad, and cards off-screen pause to save bandwidth.
function reviewAdCards() {
  if (!adCardWatch.size) return;
  const vh = window.innerHeight || 800;
  adCardWatch.forEach(item => {
    const el = item.el;
    if (!el || !el.isConnected) { adCardWatch.delete(item); return; }
    const v = el.querySelector('video');
    if (!v) return;
    const r = el.getBoundingClientRect();
    const visible = r.top < vh * 0.92 && r.bottom > vh * 0.08;
    adSetState(el, v, visible, true);
  });
}

function adSetState(el, v, playIt, keepAlive = true) {
  if (playIt) {
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
    if (!el.dataset.seen) {
      el.dataset.seen = '1';
      if (!adSeen) { adSeen = true; vastTrack('impression'); }
    }
  } else if (!v.paused) {
    v.pause();
  }
}

let adReviewBusy = false;
window.addEventListener('scroll', () => {
  if (adReviewBusy) return;
  adReviewBusy = true;
  setTimeout(() => { adReviewBusy = false; reviewAdCards(); }, 160);
}, { passive: true });

function watchAdCard(el) {
  const v = el.querySelector('video');
  if (!v) return;
  adCardWatch.add({ el });
  // Eager IO: pre-warms the stream shortly before the card scrolls into view,
  // the throttled scroll pass picks the single active card.
  const io = new IntersectionObserver(entries => {
    let any = false;
    entries.forEach(en => { if (en.isIntersecting) any = true; });
    if (any) reviewAdCards();
    else if (!v.paused && adCardWatch.size > 1) v.pause();
  }, { threshold: 0.05, rootMargin: '140px 0px' });
  io.observe(el);
  reviewAdCards(); // first paint: if it's already in view, start now
}

// Insert one sponsored card into every row that paints anywhere in the app —
// home rails, movie category shelves, series categories, anime genre shelves,
// detail "Related" rows, search result rows and every grid. Personal spaces
// (Continue Watching) stay clean. Idempotent: a row only ever gets one card.
function decorateRow(rowRow) {
  if (!rowRow || !rowRow.querySelector) return;
  const id = rowRow.id || '';
  if (adExcludedRows.includes(id) || rowRow.closest('#readerView')) return;
  if (rowRow.querySelector('.ad-card')) return;
  const kids = [...rowRow.children].filter(c => !c.classList.contains('ad-card'));
  if (kids.length < 6) return;
  // Home rails: ONE sponsored card at a random spot inside the first five shows.
  // Dedicated category shelves: it slots in after every five shows, with a random
  // start point so the rhythm never looks templated.
  const home = !!rowRow.closest('#homeRows');
  const slots = [];
  if (home) {
    slots.push(1 + Math.floor(Math.random() * 5));
  } else {
    const first = 1 + Math.floor(Math.random() * 3);
    for (let i = first; i < kids.length - 1; i += 5) slots.push(i);
  }
  slots.sort((a, b) => b - a); // place back-to-front so earlier indexes stay valid
  for (const i of slots) {
    if (i < 1 || i >= kids.length) continue;
    const card = buildAdCard();
    kids[i].insertAdjacentElement('afterend', card);
    watchAdCard(card);
  }
}

// A card whose stream failed waits on the placeholder; when a fresh creative
// resolves, hand it the new source (guarded by a stamp so playing ads are never
// restarted by a decorate pass).
function syncAdCardSources() {
  if (!adCreative || !adCreative.media || !adCreative.media.url) return;
  const src = vastResolveUrl(VAST_TAG_URL, adCreative.media.url);
  document.querySelectorAll('.ad-card video').forEach(v => {
    if (!v.isConnected || v.dataset.adSrc === src) return;
    v.dataset.adSrc = src;
    v.src = src;
  });
  const click = adCreative.click || '';
  document.querySelectorAll('.ad-card .ad-card-link').forEach(a => {
    if (click) a.href = click; else a.removeAttribute('href');
  });
}

async function decorateHomeRailAds() {
  const ad = await ensureAdCreative();
  if (!ad) return; // no ad available right now: rows stay clean, retry on next paint
  syncAdCardSources();
  document.querySelectorAll('.row').forEach(decorateRow);
  decorateGrid();
}

// Grids get the same every-five rhythm: the infinite "View All" grid, plus My List,
// Continue Watching (rows only, no cards), search results and any other .grid shelf.
// A per-container watermark tracks how far decoration has reached so appended batches
// keep their spacing without ever re-inserting into the same place twice.
let gridAdUpTo = 0;               // #browseGrid watermark (resetGridAds callers rely on it)
const gridAdMarks = new WeakMap(); // every other grid's watermark
// A grid repaint (sort change, bigger batch) wipes existing cards from the DOM;
// the watermark must start over so the rhythm is rebuilt after every repaint.
function resetGridAds() {
  gridAdUpTo = 0;
  const grid = document.getElementById('browseGrid');
  if (grid) gridAdMarks.delete(grid);
  adCardWatch.forEach(it => { if (it.el && !it.el.isConnected) adCardWatch.delete(it); }); // drop cards wiped by a repaint
}
function decorateGridInto(grid) {
  if (!grid || grid.classList.contains('hidden') || grid.closest('#readerView')) return;
  const kids = [...grid.children].filter(c => !c.classList.contains('ad-card') && !c.classList.contains('state'));
  if (kids.length < 6) return;
  let mark = grid.id === 'browseGrid' ? gridAdUpTo : (gridAdMarks.get(grid) || 0);
  if (kids.length < mark) mark = 0; // grid was repainted (nav to another shelf, new search)
  let idx = mark;
  while (true) {
    const next = idx + 4 + Math.floor(Math.random() * 2); // first after ~4-5 shows, then every 5
    if (next >= kids.length - 1) break;
    const card = buildAdCard();
    kids[next].insertAdjacentElement('afterend', card);
    idx = next + 1;
    if (grid.id === 'browseGrid') gridAdUpTo = idx; else gridAdMarks.set(grid, idx);
  }
}
function decorateGrid() {
  const browse = document.getElementById('browseGrid');
  if (!browse || browse.classList.contains('hidden')) gridAdUpTo = 0;
  ['browseGrid', 'myListGrid', 'continueGrid', 'comingGrid', 'searchResults'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('hidden')) decorateGridInto(el);
  });
  document.querySelectorAll('.grid:not(#browseGrid)').forEach(decorateGridInto);
}

// Rows can appear any time (lazy category rows, infinite scroll, view gains):
// watch for them instead of hooking every painter.
const adRowObserver = window.MutationObserver
  ? new MutationObserver(() => {
      if (adCreative) decorateHomeRailAds();
    })
  : null;
if (adRowObserver) {
  const sched = () => { clearTimeout(adRowObserver._t); adRowObserver._t = setTimeout(() => { if (adCreative) decorateHomeRailAds(); }, 120); };
  adRowObserver.observe(document.documentElement, { childList: true, subtree: true });
  adRowObserver._t = 0;
}

// Ad creative can recover later: if the first fetch failed, retry quietly on a timer.
(function adRetryLoop() {
  setInterval(() => {
    if (!adCreative) decorateHomeRailAds().catch(() => {});
  }, 30000);
})();

// Warmed at boot: the creative resolves while the first shelves paint, so the
// cards stream right away instead of placeholder-waiting for the VAST round-trip.
(function preheatAdCreative() {
  try { ensureAdCreative(); } catch (_) {}
})();
try { document.addEventListener('visibilitychange', () => { if (!document.hidden && !adCreative) decorateHomeRailAds().catch(() => {}); }); } catch (_) {}
