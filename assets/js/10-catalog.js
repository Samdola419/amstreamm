function titleOf(m) { return m.title?.english || m.title?.romaji || m.title || m.name || 'Untitled'; }
function stripHtml(s) { return (s || '').replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim(); }
function esc(s) { return String(s || '').replace(/`/g, "'").replace(/\\/g, ''); }

/* Proxy through our Vercel API to avoid CORS */
async function fetchMovies(page = 1) {
  const res = await fetch(`/api/movies?page=${page}`);
  if (!res.ok) throw new Error('Movies API ' + res.status);
  const data = await res.json();
  const items = (data.result || []).map(m => {
    const imdb = m.imdb_id || '';
    const tmdb = m.tmdb_id || '';
    return {
      _type: 'movie', id: imdb || tmdb, imdb, tmdb,
      _title: (m.title || 'Movie').replace(/\s+\d{4}$/, ''),
      _poster: m.poster || (imdb ? `https://images.metahub.space/poster/medium/${imdb}/img` : ''),
      _backdrop: m.backdrop || (imdb ? `https://images.metahub.space/background/medium/${imdb}/img` : ''),
      _sub: [m.year || String(m.released || '').slice(0,4), m.quality || 'Movie'].filter(Boolean).join(' · '),
      _year: Number(m.year || String(m.released || '').slice(0,4)) || 0,
      _genres: Array.isArray(m.genre) ? m.genre : [], _src: 'VidSrc',
      embed: (m.embed_url || '').replace(/^http:\/\//, 'https://')
    };
  });
  items._pages = Number(data.pages) || 0;
  return items;
}
function mapCinemetaMovie(m) {
  const imdb = m.imdb_id || (String(m.id || '').startsWith('tt') ? m.id : '');
  const year = m.year || String(m.released || '').slice(0, 4);
  return {
    _type: 'movie', id: imdb, imdb, tmdb: m.moviedb_id || '',
    _title: m.name || 'Movie',
    _poster: imdb ? `https://images.metahub.space/poster/medium/${imdb}/img` : (m.poster || ''),
    _backdrop: imdb ? `https://images.metahub.space/background/medium/${imdb}/img` : (m.background || ''),
    _sub: [year, m.imdbRating ? `★ ${m.imdbRating}` : '', (m.genre || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    _year: Number(year) || 0, _genres: Array.isArray(m.genre) ? m.genre : [],
    _src: 'Cinemeta',
    embed: imdb ? `https://vid-src.top/embed/movie/${imdb}` : '',
    summary: m.description || '', trailer: m.trailer || null, trailers: m.trailers || m.videos || []
  };
}
async function fetchCinemetaMovies(extra = '') {
  const path = extra
    ? `${CINEMETA}/catalog/movie/top/${extra}.json`
    : `${CINEMETA}/catalog/movie/top.json`;
  return cachedCatalog('cinemeta:' + path, async () => {
    const res = await fetch(path);
    if (!res.ok) throw new Error('Movie catalog ' + res.status);
    const data = await res.json();
    return (data.metas || []).map(mapCinemetaMovie).filter(m => m.imdb);
  });
}
async function fetchNewMovies(page = 1) {
  // The original New Movies feed depends on the upstream VidSrc catalog. When that feed is empty or unavailable,
  // build a real-title fallback from the project's existing Cinemeta catalogs and sort by release year.
  try {
    const primary = await fetchMovies(page);
    if (primary.length) return primary;
  } catch (error) { console.warn('New Movies primary feed unavailable; using catalog fallback.', error); }
  if (!newMovieFallbackCache) {
    newMovieFallbackCache = Promise.all([
      fetchCinemetaMovies(),
      fetchCinemetaMovies('genre=Action'),
      fetchCinemetaMovies('genre=Comedy'),
      fetchCinemetaMovies('genre=Animation'),
      fetchCinemetaMovies('genre=Adventure'),
      fetchCinemetaMovies('genre=Drama'),
      fetchCinemetaMovies('genre=Sci-Fi')
    ].map(p => p.catch(() => []))).then(groups => {
      const unique = new Map();
      groups.flat().forEach(m => { if (m && m.imdb && !unique.has(m.imdb)) unique.set(m.imdb, m); });
      return [...unique.values()].sort((a,b) => (b._year||0)-(a._year||0) || (a._title||'').localeCompare(b._title||''));
    }).catch(() => []);
  }
  const all = await newMovieFallbackCache;
  const out = all.slice((page - 1) * 24, page * 24);
  out._pages = Math.max(1, Math.ceil(all.length / 24));
  return out;
}
async function fetchVidTv(page = 1) {
  const res = await fetch(`/api/tv?page=${page}`);
  if (!res.ok) throw new Error('TV API ' + res.status);
  const data = await res.json();
  return (data.result || []).map(m => ({
    _type: 'tv', id: m.tmdb_id || m.imdb_id, imdb: m.imdb_id, tmdb: m.tmdb_id,
    _title: m.title, _poster: m.poster || '',
    _backdrop: m.backdrop || (m.imdb_id ? `https://images.metahub.space/background/medium/${m.imdb_id}/img` : ''),
    _sub: 'Series', _src: 'VidSrc'
  }));
}
async function fetchTvmazePopular() {
  return cachedCatalog('tvmaze:popular-shows', async () => {
    const pages = await Promise.all([0, 1, 2].map(p =>
      fetch(`${TVMAZE}/shows?page=${p}`).then(r => { if (!r.ok) throw new Error('TV catalog ' + r.status); return r.json(); }).catch(() => [])
    ));
    const all = pages.flat();
    all.sort((a, b) => (b.rating?.average || 0) - (a.rating?.average || 0));
    return all.filter(s => s.externals?.imdb).slice(0, 60).map(mapTvmaze);
  });
}
async function searchTvmaze(q) {
  const res = await fetch(`${TVMAZE}/search/shows?q=${encodeURIComponent(q)}`);
  return (await res.json()).map(x => mapTvmaze(x.show)).filter(s => s.imdb);
}
function mapTvmaze(s) {
  return {
    _type: 'tv', id: s.id, imdb: s.externals?.imdb, tvmaze: s.id,
    _title: s.name, _poster: s.image?.original || s.image?.medium || '', _posterFallback: s.image?.medium && s.image?.medium !== s.image?.original ? s.image.medium : '',
    _backdrop: s.externals?.imdb ? `https://images.metahub.space/background/medium/${s.externals.imdb}/img` : '',
    _sub: [(s.premiered || '').slice(0, 4), s.rating?.average ? `★ ${s.rating.average}` : '', (s.genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    _src: 'TVmaze', summary: stripHtml(s.summary), premiered: s.premiered, genres: Array.isArray(s.genres) ? s.genres : [], trailer: s.trailer || null, trailers: s.trailers || s.videos || []
  };
}
function mapAnime(m) {
  return {
    ...m, _type: 'anime', _title: titleOf(m),
    _poster: m.coverImage?.extraLarge || m.coverImage?.large || m.coverImage?.medium || m.poster || '',
    _sub: [m.seasonYear, m.averageScore ? `★ ${(m.averageScore/10).toFixed(1)}` : '', (m.genres||[]).slice(0,2).join(', ')].filter(Boolean).join(' · '),
    _src: 'AniList'
  };
}

function posterCandidates(item) {
  if (!item) return [];
  const type = item._type || item.type || 'anime';
  const urls = [
    item._poster, item._posterFallback, item.coverImage?.extraLarge, item.coverImage?.large, item.coverImage?.medium,
    item.image?.original, item.image?.medium, item.poster, item.cover,
    item.imdb && String(item.imdb).startsWith('tt') ? `https://images.metahub.space/poster/medium/${item.imdb}/img` : '',
    type === 'movie' && item.tmdb ? `/api/poster?tmdb=${encodeURIComponent(item.tmdb)}` : ''
  ];
  return [...new Set(urls.filter(url => typeof url === 'string' && url.trim()))];
}
function posterSrc(item) { return posterCandidates(item)[0] || ''; }
function handlePosterError(img) {
  if (!img) return;
  let fallbacks = [];
  try { fallbacks = JSON.parse(img.dataset.posterFallback || '[]'); } catch (_) {}
  if (fallbacks.length) {
    const next = fallbacks.shift();
    img.dataset.posterFallback = JSON.stringify(fallbacks);
    if (next && next !== img.src) { img.src = next; return; }
  }
  if (img.dataset.hideOnFail) { dropCard(img); return; }
  img.style.display = 'none';
  if (img.nextElementSibling) img.nextElementSibling.style.display = 'grid';
}
// Browsing shelves hide manga/comics that have no usable poster; search still shows everything.
function withPoster(items) {
  const out = (items || []).filter(i => i && i._poster).map(i => { i._hideNoPoster = true; return i; });
  out._total = items?._total || 0;
  return out;
}
function dropCard(img) {
  const card = img.closest('.card');
  if (!card) return;
  const row = card.parentElement;
  card.remove();
  if (row && row.classList.contains('row') && !row.querySelector('.card')) row.closest('.section')?.remove();
}
function posterLoaded(img) { if (img.naturalWidth < 80 || img.naturalHeight < 80) dropCard(img); } // blank/placeholder thumbnails
function registerMedia(item) {
  const key = 'm' + (++mediaRegistryCounter);
  mediaRegistry.set(key, item);
  return key;
}
function openDetailsByKey(key) {
  const item = mediaRegistry.get(key);
  if (item) openDetails(item);
}
function cardHTML(item) {
  if (!item) return '';
  const type = item._type || item.type || 'anime';
  const title = item._title || item.title || 'Untitled';
  const sub = item._sub || item.sub || '';
  const posters = posterCandidates(item);
  const poster = posters[0] || '';
  const key = registerMedia(item);
  const letter = title[0]?.toUpperCase() || '?';
  const safeTitle = escHtml(title);
  const img = poster
    ? `<img src="${escAttr(poster)}" data-poster-fallback="${escAttr(JSON.stringify(posters.slice(1)))}" alt="${safeTitle} poster" loading="lazy" decoding="async"${item._hideNoPoster ? ' data-hide-on-fail="1" onload="posterLoaded(this)"' : ''} onerror="handlePosterError(this)">` +
      `<div class="card-ph" style="display:none">${escHtml(letter)}</div>`
    : `<div class="card-ph">${escHtml(letter)}</div>`;
  const saved = isSaved(item);
  return `<div class="card" data-media-key="${key}" data-preview-id="${trailerYoutubeId(item)}" onclick="openDetailsByKey('${key}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openDetailsByKey('${key}')}" role="button" tabindex="0" aria-label="View details for ${safeTitle}">
    <div class="card-poster">
      ${img}
      <div class="card-preview" aria-hidden="true"></div>
      <span class="card-type ${type}">${type === 'tv' ? 'series' : escHtml(type)}</span>
      <button class="card-add${saved ? ' saved' : ''}" type="button" onclick="event.stopPropagation();cardAddToggle(this,'${key}')" aria-label="${saved ? 'In My List' : 'Add to My List'}" title="${saved ? 'In My List' : 'Add to My List'}"><i class="${saved ? 'ri-check-line' : 'ri-add-line'}" aria-hidden="true"></i></button>
      ${progressLabel(item) ? `<span class="card-resume">${escHtml(progressLabel(item))}</span>` : ''}
      <div class="card-hover-actions"><span><i class="ri-information-line" aria-hidden="true"></i> View details</span></div>
    </div>
    <div class="card-title">${safeTitle}</div>
    <div class="card-sub">${escHtml(sub)}</div>
  </div>`;
}

let activeCardPreview = null;
let cardPreviewTimer = 0;
let cardPreviewRequest = 0;
function stopCardPreview(card) {
  if (!card) return;
  const holder = card.querySelector('.card-preview');
  if (holder) holder.replaceChildren();
  card.classList.remove('previewing', 'preview-pending');
  if (activeCardPreview === card) activeCardPreview = null;
}
function clearPendingCardPreview() {
  if (cardPreviewTimer) clearTimeout(cardPreviewTimer);
  cardPreviewTimer = 0;
}
document.addEventListener('pointerover', event => {
  if (event.pointerType === 'touch' || event.pointerType === '') return;
  const card = event.target.closest?.('.card');
  if (!card || (event.relatedTarget && card.contains(event.relatedTarget))) return;
  if (activeCardPreview && activeCardPreview !== card) stopCardPreview(activeCardPreview);
  clearPendingCardPreview();
  if (card.classList.contains('previewing')) return;
  const request = ++cardPreviewRequest;
  card.classList.add('preview-pending');
  cardPreviewTimer = setTimeout(async () => {
    cardPreviewTimer = 0;
    const item = mediaRegistry.get(card.dataset.mediaKey);
    let trailerId = card.dataset.previewId || '';
    if (!trailerId && item) {
      try { trailerId = await resolveTrailerId(item); } catch (_) { trailerId = ''; }
    }
    if (request !== cardPreviewRequest || !trailerId || !card.isConnected || !card.matches(':hover')) {
      card.classList.remove('preview-pending');
      return;
    }
    card.dataset.previewId = trailerId;
    const holder = card.querySelector('.card-preview');
    if (!holder) return;
    const frame = document.createElement('iframe');
    frame.src = youtubePreviewUrl(trailerId);
    frame.title = 'Muted trailer preview';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture';
    frame.loading = 'eager';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    holder.appendChild(frame);
    card.classList.remove('preview-pending');
    card.classList.add('previewing');
    activeCardPreview = card;
  }, 420);
});
document.addEventListener('pointerout', event => {
  const card = event.target.closest?.('.card');
  if (!card || (event.relatedTarget && card.contains(event.relatedTarget))) return;
  clearPendingCardPreview();
  ++cardPreviewRequest;
  stopCardPreview(card);
});

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escAttr(value) { return escHtml(value).replace(/`/g, '&#96;'); }
function rowHTML(titleHtml, items, moreMode, rowId, moreGenre) {
  if (!items?.length) return '';
  const id = rowId || ('row' + Math.random().toString(36).slice(2, 8));
  const more = moreMode
    ? `<button class="section-more" onclick="nav('${moreMode}'${moreGenre ? `,'${moreGenre}'` : ''})">View All <i class="ri-arrow-right-s-line" aria-hidden="true"></i></button>`
    : '';
  return `<section class="section">
    <div class="section-head">
      <h2 class="section-title">${titleHtml}</h2>
      ${more}
    </div>
    <div class="row-wrap">
      <div class="row" id="${id}">${items.map(cardHTML).join('')}</div>
    </div>
  </section>`;
}
(function rowDrag() {
  let row = null, startX = 0, startLeft = 0, moved = false;
  document.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const r = e.target.closest && e.target.closest('.row'); if (!r) return;
    row = r; startX = e.clientX; startLeft = r.scrollLeft; moved = false;
  });
  document.addEventListener('pointermove', e => {
    if (!row) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 6) { moved = true; row.classList.add('dragging'); }
    if (moved) row.scrollLeft = startLeft - dx;
  });
  const end = () => { if (row) { const r = row; setTimeout(() => r.classList.remove('dragging'), 0); } row = null; };
  document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
  document.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
})();
function scrollRow(id, dir) {
  const el = document.getElementById(id);
  if (el) el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.8, 600), behavior: 'smooth' });
}

let currentScreenId = 'homeView';
function shouldHideTopNavForContext(screenId = currentScreenId) {
  const searchOpen = $('searchOverlay')?.classList.contains('show');
  const adOpen = $('vastAdOverlay')?.classList.contains('is-visible');
  // Dedicated immersive surfaces already provide their own navigation or controls.
  // Keep the dock off the player, item-detail hero, full-screen Search, and ad overlay.
  return screenId === 'playerView' || screenId === 'readerView' || screenId === 'detailView' || Boolean(searchOpen) || Boolean(adOpen);
}
function syncTopNavContext(screenId = currentScreenId) {
  const wrap = document.querySelector('.topnav-wrap');
  if (!wrap) return;
  const hideForContext = shouldHideTopNavForContext(screenId);
  wrap.classList.toggle('context-hidden', hideForContext);
  if (hideForContext) wrap.classList.remove('nav-hidden');
  else if ((window.scrollY || 0) < 38) wrap.classList.remove('nav-hidden');
}
function setNav(mode) {
  document.querySelectorAll('.nav-link, .yt-chip, .yt-drawer-item, .side-item').forEach(el => {
    if (!el.dataset.nav) return;
    el.classList.toggle('active', el.dataset.nav === mode);
  });
}
