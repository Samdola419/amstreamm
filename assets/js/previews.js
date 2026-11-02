// ---- Preview trailers (MovieBox-style) ----
// Only the hero banner plays a short muted clip of the title. Cards stay static
// posters (no hover previews). Clips come from YouTube trailers: AniList ships
// them for anime; cinemeta resolves films and series on request. All muted.
'use strict';

const TRAILER_CACHE_KEY = 'animestream.trailers.v1';
function trailerCacheRead() {
  try { const v = JSON.parse(localStorage.getItem(TRAILER_CACHE_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; }
  catch (_) { return {}; }
}
function trailerCacheWrite(map) {
  try {
    const keys = Object.keys(map);
    if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(k => delete map[k]); // keep the map small on phones
    localStorage.setItem(TRAILER_CACHE_KEY, JSON.stringify(map));
  } catch (_) {}
}

function ytEmbed(id, start) {
  return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id)
    + '?autoplay=1&mute=1&controls=0&loop=1&playlist=' + encodeURIComponent(id)
    + '&modestbranding=1&rel=0&playsinline=1&iv_load_policy=3&start=' + (start || 8);
}

// Resolves a YouTube id for an item: anime straight from AniList data; films and series via
// cinemeta (cached in localStorage). Returns a promise of '' when nothing is available.
function trailerFor(item) {
  if (!item) return Promise.resolve('');
  const type = item._type || item.type || 'anime';
  if (type === 'anime') {
    const tr = item.trailer;
    return Promise.resolve(tr && tr.id && /youtube/i.test(String(tr.site || 'youtube')) ? String(tr.id) : '');
  }
  const t = item._type || item.type;
  const imdb = t === 'movie' || t === 'tv' ? (item.imdb || '') : '';
  if (! imdb || !String(imdb).startsWith('tt')) return Promise.resolve('');
  const cache = trailerCacheRead();
  if (cache[imdb]) return Promise.resolve(cache[imdb]);
  return fetch(CINEMETA + '/meta/' + (t === 'movie' ? 'movie' : 'series') + '/' + encodeURIComponent(imdb) + '.json')
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      const meta = j && j.meta;
      if (!meta) return '';
      // cinemeta shapes vary: trailerStreams [{url:'youtube:<id>'}], trailers [{title, ytId}]
      const list = [].concat(Array.isArray(meta.trailerStreams) ? meta.trailerStreams : [], Array.isArray(meta.trailers) ? meta.trailers : []);
      let id = '';
      for (const s of list) {
        if (!s) continue;
        const raw = typeof s === 'string' ? s : (s.ytId || s.url || '');
        const m = /^youtube:(.+)/i.exec(raw) || /youtu\.?be[^\/]*\/(?:watch\?v=|embed\/)?([\w-]{6,15})/i.exec(raw) || /^([\w-]{8,15})$/.exec(raw);
        if (m) { id = m[1]; break; }
      }
      if (id) { cache[imdb] = id; trailerCacheWrite(cache); }
      return id;
    })
    .catch(() => '');
}

// ------------------------------ hero banner trailer ------------------------------
// showPage('homeView') keeps #hero mounted; only render while the home screen is live,
// and never fight the ad overlay: the trailer quietly stands behind the artwork.
// While a slide plays, the NEXT slide's clip is created in a hidden "staged" slot so
// it is fully buffered before the rotation switches — no blank/buffer beat.
let heroToken = 0;        // a fresh slide invalidates stale loads
let heroStaged = null;    // { key, frame } — next slide's clip, booting off-screen
const heroKeyOf = h => h ? [h.title || h._title || '', h.type || h._type || ''].join('|') : '';

function buildHeroFrame(id) {
  const frame = document.createElement('iframe');
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.allow = 'autoplay; encrypted-media; picture-in-picture';
  frame.src = ytEmbed(id, 10 + Math.floor(Math.random() * 20));
  return frame;
}

window.prefetchHeroTrailer = function (h) {
  const stage = $('heroTrailerBox');
  if (!stage || !h || document.hidden || (window.currentScreenId && currentScreenId !== 'homeView') || heroItemsLength() < 2) return;
  const token = heroToken;
  const key = heroKeyOf(h);
  if (heroStaged && heroStaged.key === key && heroStaged.frame.isConnected) return;
  trailerFor(h).then(id => {
    if (token !== heroToken || !id) return;
    if (heroStaged) { try { heroStaged.frame.remove(); } catch (_) {} heroStaged = null; }
    const frame = buildHeroFrame(id);
    frame.className = 'hero-staged'; // stays invisible until the swap promotes it
    stage.appendChild(frame);
    heroStaged = { key, frame };
  });
};
function heroItemsLength() { return typeof heroItems !== 'undefined' ? heroItems.length : 0; }

window.mountHeroTrailer = function (h) {
  const stage = $('heroTrailerBox');
  if (!stage) return;
  if (!h || document.hidden || (window.currentScreenId && currentScreenId !== 'homeView')) {
    stage.classList.remove('ready'); stage.innerHTML = ''; heroStaged = null; return;
  }
  heroToken++;
  const token = heroToken;
  const want = heroKeyOf(h);
  // The staged clip belongs to this incoming slide: promote it with a gentle fade.
  if (heroStaged && heroStaged.key === want && heroStaged.frame.isConnected) {
    const staged = heroStaged;
    heroStaged = null;
    stage.classList.add('ready');
    staged.frame.classList.remove('hero-staged'); // sync swap: CSS transition fades it in
    stage.querySelectorAll('iframe').forEach(f => {
      if (f === staged.frame) return;
      f.style.opacity = '0';
      setTimeout(() => { if (f.isConnected) f.remove(); }, 850);
    });
    return;
  }
  // No staged clip (first paint, dot click, swipe): load fresh as before.
  stage.classList.remove('ready');
  stage.innerHTML = '';
  heroStaged = null;
  trailerFor(h).then(id => {
    if (token !== heroToken || !id) return;
    const frame = buildHeroFrame(id);
    frame.onload = () => { if (frame.isConnected && token === heroToken) stage.classList.add('ready'); };
    stage.appendChild(frame);
  });
};
