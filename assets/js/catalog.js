/* ----------------------------------------------------------------------
   AnimeStream home experience + hero + browse collections
   ---------------------------------------------------------------------- */
const CATEGORIES = ['Trending','Popular','Comedy','Romance','Action','Fantasy','Adventure','Drama','Sci-Fi','Slice of Life','Supernatural','Mystery','Horror','Psychological','Sports','Mahou Shoujo','Mecha','Music','Thriller','Ecchi','Hentai'];
const HOME_KEY = { Trending:'animeTrend', Popular:'animePop', Comedy:'comedy', Romance:'romance', Action:'action' };
// Full category lists per domain — everywhere from Comedy up to the 18 Plus shelf.
const MOVIE_CATEGORIES = ['Action','Adventure','Animation','Comedy','Crime','Documentary','Drama','Family','Fantasy','History','Horror','Music','Mystery','Romance','Science Fiction','Thriller','War','Western','Adult'];
const SERIES_CATEGORIES = ['Action','Adventure','Animation','Children','Comedy','Crime','Documentary','Drama','Family','Fantasy','History','Horror','Music','Mystery','Romance','Science Fiction','Thriller','War','Western','Adult'];
const CAT_LABEL = { Adult: '18 Plus', Hentai: '18 Plus' };
function animeQuery(genre, page) {
  if (genre === 'Trending') return anilist(Q_ANIME_TREND, { page });
  if (genre === 'Popular') return anilist(Q_ANIME_POP, { page });
  if (genre === 'Hentai') return anilist(Q_ANIME_GENRE_ADULT, { page, genre }); // adult titles live in their own AniList bucket
  return anilist(Q_ANIME_GENRE, { page, genre });
}
function infiniteMode() { return browseMode === 'anime' || browseMode === 'genre'; }
function maybeLoadMore() {
  if (!infiniteMode() || !browseGenre || browseLoading || !browseHasMore) return;
  if ($('browseView').classList.contains('hidden-page')) return;
  const r = $('browseSentinel').getBoundingClientRect();
  if (r.top < window.innerHeight + 900) loadMoreBrowse();
}
let _scrollTick = false;
['scroll','resize'].forEach(ev => window.addEventListener(ev, () => { if (_scrollTick) return; _scrollTick = true; requestAnimationFrame(() => { _scrollTick = false; maybeLoadMore(); }); }, { passive: true }));
function loadCatRow(sec) {
  const genre = sec.dataset.genre;
  const catType = sec.dataset.catType || 'anime';
  sec.dataset.state = 'loading';
  const key = catType === 'anime' ? HOME_KEY[genre] : null;
  let p;
  if (key && homeCollections[key]?.length) p = Promise.resolve(homeCollections[key]);
  else if (catType === 'movie') p = fetchCinemetaCatalog('movie', genre);
  else if (catType === 'series') p = fetchCinemetaCatalog('series', genre);
  else p = animeQuery(genre, 1).then(d => (d.Page.media || []).map(mapAnime));
  p.then(items => {
    if (!sec.isConnected) return;
    if (!items.length) { sec.remove(); return; }
    const wrap = document.createElement('div');
    wrap.innerHTML = rowHTML(`<em>${escHtml(CAT_LABEL[genre] || genre)}</em>`, items.slice(0,24), catalogMoreMode(catType), 'cat_' + genre.replace(/\W/g,''), genre);
    sec.replaceWith(wrap.firstElementChild);
  }).catch(() => {
    sec.dataset.state = '';
    sec.querySelector('.cat-slot').innerHTML = `Could not load. <button class="cat-retry">↻ Retry</button>`;
    sec.querySelector('.cat-retry')?.addEventListener('click', () => {
      sec.dataset.state = 'loading';
      sec.querySelector('.cat-slot').textContent = 'Loading…';
      loadCatRow(sec);
    });
    if (!sec.dataset.autoRetried) { // one silent retry: feeds sometimes hiccup
      sec.dataset.autoRetried = '1';
      setTimeout(() => { if (sec.isConnected && sec.dataset.state === '') loadCatRow(sec); }, 6000);
    }
  });
}
function catalogMoreMode(catType) {
  return catType === 'movie' ? 'movies' : catType === 'series' ? 'series' : 'genre';
}
let catObserver = null;
function observeCatRows(root) {
  if (catObserver) catObserver.disconnect();
  catObserver = new IntersectionObserver(entries => entries.forEach(en => {
    if (!en.isIntersecting) return;
    catObserver.unobserve(en.target);
    loadCatRow(en.target);
  }), { rootMargin: '700px 0px' });
  root.querySelectorAll('.cat-lazy').forEach(el => catObserver.observe(el));
}
function catSkeleton(genre, catType = 'anime') {
  const label = escHtml(CAT_LABEL[genre] || genre);
  const more = catType === 'movie'
    ? `nav('movies','${escAttr(genre)}')`
    : catType === 'series'
      ? `nav('series','${escAttr(genre)}')`
      : `nav('genre','${escAttr(genre)}')`;
  return `<section class="section cat-lazy" data-genre="${escAttr(genre)}" data-cat-type="${catType}"><div class="section-head"><h2 class="section-title"><em>${label}</em></h2><button class="section-more" onclick="${more}">View All <i class="ri-arrow-right-s-line" aria-hidden="true"></i></button></div>` +
    `<div class="state cat-slot">Loading…</div></section>`;
}
// Display-name helper for chips: Adult/Hentai read as "18 Plus" everywhere.
function catLabel(g) { return CAT_LABEL[g] || g; }
// Which domain the Category hub currently shows (Movies / Anime / Series).
let categoryDomain = 'anime';
function nav(mode, genre, silent) {
  // Three dedicated pages: Movies, Series, Anime (same layout). The old /category hub is gone;
  // any old link to it lands on the Anime page (or the domain it asked for).
  if (mode === 'category') {
    mode = ['movies', 'series', 'anime'].includes(genre) ? genre : 'anime';
    genre = null;
  }
  // nav tracing (temporary diagnostics): set localStorage.setItem('debugnav','1') in console
  try { if (localStorage.getItem('debugnav')) console.warn('[nav]', mode, genre ?? '(no genre)', 'silent=' + !!silent); } catch (_) {}
  if (NAV_ON[mode === 'genre' || mode === 'category' ? 'anime' : mode] === false) mode = 'home';
  setNav(mode === 'genre' || mode === 'category' ? 'anime' : mode);
  closeSearch();
  if (!silent) {
    if (mode === 'home') pushHist({ kind: 'home' });
    else pushHist({ kind: 'browse', mode, genre: genre || null });
  }
  if (mode === 'home') { browseMode = null; browseGenre = null; showPage('homeView'); return; }
  if (mode === 'mylist') { openMyList(true); return; }
  if (mode === 'continue') { openContinue(true); return; }
  if (mode === 'coming') { openComing(true); return; }
  if (mode === 'manga') { openManga(genre); return; }
  showPage('browseView');
  renderCatTabs(mode);
  // Movies / Series / Anime keep the big poster banner. Only a single-genre shelf is compact.
  const compactShelf = mode === 'genre';
  document.body.classList.toggle('genre-shelf', mode === 'genre');
  document.body.classList.remove('category-hub');
  $('browseHero').style.display = compactShelf ? 'none' : '';
  $('catHead').classList.toggle('hidden', !compactShelf);
  $('catHeadTitle').textContent = catLabel(genre || '') || 'Category';
  browseMode = mode;
  browseGenre = genre || null;
  browsePage = 1;
  browseSkip = 0;
  browseItems = [];
  browseHasMore = true;
  browseLoading = false;
  const requestId = ++browseRequestId;
  const titles = {
    movies: catLabel(browseGenre || '') ? `${catLabel(browseGenre)} Movies` : 'Movies',
    series: catLabel(browseGenre || '') ? `${catLabel(browseGenre)} Series` : 'Series',
    anime: catLabel(genre || '') ? `${catLabel(genre)} Anime` : 'Anime',
    category: 'Categories'
  };
  $('browseTitle').textContent = titles[mode] || mode;
  refreshBrowseHeader(true);
  const sort=$('browseSort'); if(sort) sort.value='default';  $('browseBar').innerHTML = '';
  $('browseRows').innerHTML = '';
  $('browseGrid').innerHTML = '<div class="state">Loading…</div>';
  $('loadMoreBtn').classList.add('hidden');
  if (!browseGenre && ['movies','series','anime','category'].includes(mode)) loadBrowseLanding(requestId);
  else loadBrowse(true, requestId);
}

/* Domain switcher lives ONLY on the Category hub ( Movies · Anime · Series ).
   Individual pages and genre shelves stay clean — no switcher buttons. */
function renderCatTabs() { const bar = $('catTabs'); if (bar) bar.hidden = true; }

/* ---- Side panel trending posters (Movies / Anime / Series) ----
   A poster per domain pinned at the top of the side panel; each one rotates to
   the next trending title of its own domain every 5 minutes. */
function setupSideTrend() {
  const box = $('sideTrend');
  if (!box || box.dataset.hooked) return;
  box.dataset.hooked = '1';
  let tick = 0;
  const paint = () => {
    const doms = { Movies: homeCollections.moviesPop, Anime: homeCollections.animeTrend, Series: homeCollections.series };
    tick++;
    const rows = ['Movies', 'Anime', 'Series'].map(k => {
      const list = (doms[k] || []).filter(x => x && x.status !== 'NOT_YET_RELEASED');
      if (!list.length) return '';
      const item = list[(tick - 1) % list.length];
      const art = item._poster || item.bannerImage || item._backdrop || posterSrc(item) || '';
      const title = escHtml(item._title || item.title || '');
      const key = registerMedia(item);
      return `<button class="trend-row trend-${k.toLowerCase()}" onclick="openDetailsByKey('${key}')" title="${title}">
        <img src="${escAttr(art)}" alt="" loading="lazy" onerror="this.replaceWith(document.createElement('span'))">
        <span class="trend-meta"><b>${k}</b><small>${title}</small></span>
        <i class="ri-arrow-right-s-line" aria-hidden="true"></i></button>`;
    }).filter(Boolean).join('');
    if (rows) {
      box.hidden = false;
      box.innerHTML = rows;
    }
  };
  paint();
  setInterval(paint, 5 * 60 * 1000);
  window.paintSideTrend = paint; // feeds still landing call this to refresh entries instantly
}

/* ---- Coming soon (anime on the way, from AniList) ---- */
let comingCache = null;
function airingLabel(m) {
  const n = m && m.nextAiringEpisode;
  const s = Number(n && n.timeUntilAiring);
  if (!Number.isFinite(s) || s <= 0) return 'Coming soon';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), min = Math.floor((s % 3600) / 60);
  if (d >= 1) return `In ${d}d${h ? ' ' + h + 'h' : ''}`;
  if (h >= 1) return `In ${h}h ${min}m`;
  return `In ${Math.max(1, min)}m`;
}
async function fetchComing(page) {
  try {
    const d = await anilist(Q_ANIME_UPCOMING, { page });
    const items = (d.Page.media || []).map(mapAnime);
    items.forEach(m => {
      const rest = [m.seasonYear, (m.genres || []).slice(0, 1).join('')].filter(Boolean).join(' · ');
      m._sub = rest ? `${airingLabel(m)} · ${rest}` : airingLabel(m);
    });
    return items;
  } catch (e) { return []; }
}
async function openComing(silent = false) {
  if (!silent && !applyingHistory) pushHist({ kind: 'browse', mode: 'coming' });
  closeSearch(); setNav('coming'); showPage('comingView');
  const grid = $('comingGrid');
  if (!comingCache) {
    grid.innerHTML = '<div class="state">Loading what\u2019s coming\u2026</div>';
    comingCache = await fetchComing(1);
  }
  renderComingGrid();
}
function renderComingGrid() {
  const list = comingCache || [];
  const count = $('comingCount');
  if (count) count.textContent = `${list.length} titles on the way`;
  const grid = $('comingGrid');
  if (grid) grid.innerHTML = list.length ? list.map(cardHTML).join('') : '<div class="state">Nothing announced yet \u2014 check back soon.</div>';
}

async function loadHome() {
  const rowsEl = $('homeRows');
  rowsEl.innerHTML = '<div class="state">Loading your first picks…</div>';
  // Paint the homepage after the three most useful feeds arrive; don't hold the whole page
  // hostage while every genre catalog finishes loading.
  const state = { animeTrend: [], animePop: [], moviesNew: [], moviesPop: [], movAction: [], movComedy: [], movAni: [], movAdv: [], series: [], romance: [], action: [], comedy: [], mangaTrend: [], mangaPop: [], comicTrend: [], comicPop: [], coming: [] };
  const paintRows = () => {
    let html = '';
    const recent = getContinueList(); // Continue Watching: anime, movies and series on this device
    if (recent.length) html += rowHTML('Continue <em>Watching</em>', recent, null, 'continueRow');
    if (state.coming.length) html += rowHTML('Coming <em>Soon</em>', state.coming.slice(0,14), 'coming', 'rowComing');
    if (state.moviesNew.length) html += rowHTML('New <em>Movies</em>', state.moviesNew.slice(0,24), 'movies', 'rowMovies', 'New');
    if (state.moviesPop.length) html += rowHTML('Popular <em>Movies</em>', state.moviesPop.slice(0,24), 'movies', 'rowMoviesPop', 'Popular');
    if (state.movAction.length) html += rowHTML('Action <em>Movies</em>', state.movAction.slice(0,24), 'movies', 'rowMovAction', 'Action');
    if (state.movComedy.length) html += rowHTML('Comedy <em>Movies</em>', state.movComedy.slice(0,24), 'movies', 'rowMovComedy', 'Comedy');
    if (state.movAni.length) html += rowHTML('Animation <em>Movies</em>', state.movAni.slice(0,24), 'movies', 'rowMovAni', 'Animation');
    if (state.movAdv.length) html += rowHTML('Adventure <em>Movies</em>', state.movAdv.slice(0,24), 'movies', 'rowMovAdv', 'Adventure');
    if (state.series.length) html += rowHTML('Trending Series <em>This Week</em>', state.series.slice(0,24), 'series', 'rowSeries', 'Popular');
    if (state.animeTrend.length) html += rowHTML('Trending <em>Anime</em>', state.animeTrend, 'genre', 'rowAnime', 'Trending');
    if (state.action.length) html += rowHTML('Action <em>Anime</em>', state.action, 'genre', 'rowAction', 'Action');
    if (state.romance.length) html += rowHTML('Romance <em>Anime</em>', state.romance, 'genre', 'rowRomance', 'Romance');
    if (state.comedy.length) html += rowHTML('Comedy <em>Anime</em>', state.comedy, 'genre', 'rowComedy', 'Comedy');
    if (state.animePop.length) html += rowHTML('Popular <em>Anime</em>', state.animePop, 'genre', 'rowAnimePop', 'Popular');
    if (state.mangaTrend.length) html += rowHTML('Trending <em>Manga</em>', state.mangaTrend.slice(0,24), 'manga', 'rowMangaTrend', 'manga');
    if (state.comicTrend.length) html += rowHTML('Trending <em>Comics</em>', state.comicTrend.slice(0,24), 'manga', 'rowComicTrend', 'comic');
    if (state.mangaPop.length) html += rowHTML('Popular <em>Manga</em>', state.mangaPop.slice(0,24), 'manga', 'rowMangaPop', 'manga|popular|');
    if (state.comicPop.length) html += rowHTML('Popular <em>Comics</em>', state.comicPop.slice(0,24), 'manga', 'rowComicPop', 'comic|popular|');
    rowsEl.innerHTML = html || '<div class="state">Could not load content. Please try again.</div>';
    if (typeof decorateHomeRailAds === 'function') decorateHomeRailAds(); // drop one sponsored card into each rail
    if ($('searchOverlay')?.classList.contains('show') && !$('searchInput').value.trim()) renderSearchIdle();
  };
  const toAnime = q => anilist(q.query, q.variables).then(d => (d.Page.media || []).map(mapAnime)).catch(() => []);
  let heroStarted = false;
  const updateCoreUI = () => {
    heroItems = [
      ...state.moviesPop.slice(0,4).map(m => ({ type:'movie', tmdb:m.tmdb, imdb:m.imdb, title:m._title, backdrop:m._backdrop||m._poster, desc:m.summary||'Pick another server below the player if the first one is blank', score:Number(String(m._sub??'').match(/★\s*([\d.]+)/)?.[1])||null, year:m._year||'' })),
      ...state.series.slice(0,3).map(s => ({ type:'tv', imdb:s.imdb, tvmaze:s.tvmaze, title:s._title, backdrop:s._backdrop||s._poster, desc:s.summary, score:Number(String(s._sub??'').match(/★\s*([\d.]+)/)?.[1])||null, year:(s.premiered||s._year||'').toString().slice(0,4) })),
      ...state.animeTrend.slice(0,3).map(m => ({ type:'anime', id:m.id, mal:m.idMal, title:m._title, raw:m, backdrop:m.bannerImage||m._poster, desc:stripHtml(m.description), score:m.averageScore?m.averageScore/10:null, year:m.seasonYear, episodes:m.episodes }))
    ].filter(h => h.title);
    if (heroItems.length) {
      renderHero(0); renderTrending();
      if (!heroStarted) { startHeroRotate(); heroStarted = true; }
    }
    homeCollections.moviesPop = state.moviesPop; homeCollections.animeTrend = state.animeTrend; homeCollections.series = state.series;
    seriesCache = state.series;
    paintRows();
    setupSideTrend();
    if (window.paintSideTrend) window.paintSideTrend();
  };
  const keyOn = k => /^(moviesNew|moviesPop|movAction|movComedy|movAni|movAdv)$/.test(k) ? SECTIONS.movies : k === 'series' ? SECTIONS.series : /^(manga|comic)/.test(k) ? SECTIONS.manga : SECTIONS.anime;
  const coreJobs = [
    ['animeTrend', () => toAnime({ query: Q_ANIME_TREND, variables: { page: 1 } })],
    ['moviesPop', () => fetchCinemetaMovies()],
    ['series', () => fetchTvmazePopular()]
  ];
  await Promise.all(coreJobs.filter(([k]) => keyOn(k)).map(async ([key, load]) => {
    try { state[key] = await load() || []; }
    catch (e) { console.warn('Could not load primary shelf:', key, e); state[key] = []; }
    updateCoreUI();
  }));
  movieCache = state.moviesNew;

  // Fill the remaining shelves in the background; catalog caching makes later visits much faster.
  const jobs = [
    ['coming', () => fetchComing(1)],
    ['moviesNew', () => fetchNewMovies(1)],
    ['movAction', () => fetchCinemetaMovies('genre=Action')],
    ['movComedy', () => fetchCinemetaMovies('genre=Comedy')],
    ['movAni', () => fetchCinemetaMovies('genre=Animation')],
    ['movAdv', () => fetchCinemetaMovies('genre=Adventure')],
    ['animePop', () => toAnime({ query: Q_ANIME_POP, variables: { page: 1 } })],
    ['romance', () => toAnime({ query: Q_ANIME_GENRE, variables: { page: 1, genre: 'Romance' } })],
    ['action', () => toAnime({ query: Q_ANIME_GENRE, variables: { page: 1, genre: 'Action' } })],
    ['comedy', () => toAnime({ query: Q_ANIME_GENRE, variables: { page: 1, genre: 'Comedy' } })],
    ['mangaTrend', () => fetchManga({ sort: 'trending' }).then(withPoster)],
    ['comicTrend', () => fetchComics({ sort: 'trending' }).then(withPoster)],
    ['mangaPop', () => fetchManga({ sort: 'popular' }).then(withPoster)],
    ['comicPop', () => fetchComics({ sort: 'popular' }).then(withPoster)]
  ];
  await Promise.all(jobs.filter(([k]) => keyOn(k)).map(async ([key, load]) => {
    try {
      const items = await load();
      state[key] = items || [];
      homeCollections[key] = state[key];
      if (key === 'moviesNew') movieCache = state.moviesNew;
    } catch (e) { console.warn('Could not load homepage shelf:', key, e); }
  }));
  paintRows();
}

function renderTrending() {
  const list = $('trendingList');
  if (!list) return;
  const items = heroItems.slice(0, 5);
  if (!items.length) { list.innerHTML = '<div class="state">Trending titles will appear here.</div>'; return; }
  list.innerHTML = items.map((h, i) => {
    const poster = posterSrc(heroMediaRecord(h)) || h.backdrop || '';
    const posterList = posterCandidates(heroMediaRecord(h)).filter(u => u !== poster);
    const meta = h.type === 'anime' ? 'Anime' : h.type === 'tv' ? 'Series' : 'Movie';
    return `<button class="trend-item" type="button" data-trend-index="${i}" aria-label="Open ${String(h.title).replace(/"/g,'&quot;')}">
      <span class="trend-rank">${String(i + 1).padStart(2,'0')}</span>
      <img class="trend-poster" src="${escAttr(poster)}" data-poster-fallback="${escAttr(JSON.stringify(posterList))}" alt="" loading="lazy" decoding="async" onerror="handlePosterError(this)">
      <span><span class="trend-name">${h.title}</span><span class="trend-meta">${meta}${h.year ? ' · ' + h.year : ''}${h.score ? ' · ★ ' + Number(h.score).toFixed(1) : ''}</span></span>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-trend-index]').forEach(btn => btn.addEventListener('click', () => {
    const h = items[Number(btn.dataset.trendIndex)];
    if (!h) return;
    const item = h.type === 'anime'
      ? { ...(h.raw||{}), _type:'anime', id:h.id, idMal:h.mal, _title:h.title, episodes:h.episodes, bannerImage:h.backdrop, description:h.desc, seasonYear:h.year, averageScore:h.score? h.score*10:null }
      : h.type === 'movie'
        ? { _type:'movie', id:h.imdb||h.tmdb, tmdb:h.tmdb, imdb:h.imdb, _title:h.title, _backdrop:h.backdrop, summary:h.desc, _sub:h.year||'Movie' }
        : { _type:'tv', id:h.tvmaze||h.imdb, imdb:h.imdb, tvmaze:h.tvmaze, _title:h.title, _poster:h.backdrop, summary:h.desc, _sub:h.year||'Series' };
    openDetails(item);
  }));
}

// Artwork fallback: race a small set of image candidates and use the first one that loads.
// This keeps banners visible even when a catalog provider's preferred backdrop is unavailable.
const artworkTokens = new WeakMap();
function setFirstAvailableArtwork(element, urls, applyUrl, timeoutMs = 6500) {
  if (!element) return;
  const token = (artworkTokens.get(element) || 0) + 1;
  artworkTokens.set(element, token);
  const candidates = [...new Set((urls || []).filter(u => { const v = typeof u === 'string' ? u.trim() : ''; return /^https?:\/\//i.test(v) || (v.startsWith('/') && !v.startsWith('//')); }).map(u => u.trim()))].slice(0, 8);
  if (!candidates.length) { applyUrl(''); return; }
  let done = false, failed = 0;
  const finish = url => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (artworkTokens.get(element) === token) applyUrl(url || '');
  };
  const timer = setTimeout(() => finish(''), timeoutMs);
  candidates.forEach(url => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => finish(url);
    image.onerror = () => { failed++; if (failed === candidates.length) finish(''); };
    image.src = url;
  });
}
function uniqueArtworkUrls(urls) { return [...new Set((urls || []).filter(v => typeof v === 'string' && v.trim()))]; }
function heroMediaRecord(h) {
  if (!h) return {};
  if (h.raw) return { ...h.raw, _type: 'anime', _poster: h.raw._poster || h.raw.coverImage?.extraLarge || h.raw.coverImage?.large || '', _backdrop: h.raw.bannerImage || h.backdrop || '' };
  if (h.type === 'movie') return movieCache.find(m => (h.imdb && m.imdb === h.imdb) || (h.tmdb && String(m.tmdb) === String(h.tmdb))) || { _type:'movie', imdb:h.imdb, tmdb:h.tmdb, _title:h.title, _poster:h.poster || '', _backdrop:h.backdrop || '' };
  return seriesCache.find(s => (h.imdb && s.imdb === h.imdb) || (h.tvmaze && String(s.tvmaze) === String(h.tvmaze))) || { _type:'tv', imdb:h.imdb, tvmaze:h.tvmaze, _title:h.title, _poster:h.poster || '', _backdrop:h.backdrop || '' };
}
function heroArtworkCandidates(h) {
  const item = heroMediaRecord(h);
  const metaBackdrop = h?.imdb ? `https://images.metahub.space/background/medium/${h.imdb}/img` : '';
  return uniqueArtworkUrls([h?.backdrop, item.bannerImage, item._backdrop, metaBackdrop, ...posterCandidates(item)]).slice(0, 8);
}

/* One builder for the hero's play/details payload — renderHero and the clip
   preloader both go through it so keys match exactly. */
function heroMediaFor(h) {
  return h.type === 'anime'
    ? { ...h.raw, _type:'anime', id:h.id, idMal:h.mal, _title:h.title, episodes:h.episodes, bannerImage:h.backdrop, description:h.desc, averageScore:h.score ? h.score*10 : null, seasonYear:h.year }
    : h.type === 'movie'
      ? { _type:'movie', id:h.imdb||h.tmdb, imdb:h.imdb, tmdb:h.tmdb, _title:h.title, _backdrop:h.backdrop, summary:h.desc, _sub:h.year||'Movie' }
      : { _type:'tv', id:h.tvmaze||h.imdb, imdb:h.imdb, tvmaze:h.tvmaze, _title:h.title, _poster:h.backdrop, summary:h.desc, _sub:h.year||'Series' };
}

function renderHero(i) {
  if (!heroItems.length) return;
  heroIdx = ((i % heroItems.length) + heroItems.length) % heroItems.length;
  const h = heroItems[heroIdx];
  const hero = $('hero');
  if (hero && hero.hidden) { hero.hidden = false; } // the MovieBox-style banner must SHOW, not wait for a caller
  if (typeof syncHeroTop === 'function') syncHeroTop();
  const heroOverlay = 'linear-gradient(90deg,rgba(0,0,0,.84),rgba(0,0,0,.35) 55%,rgba(0,0,0,.02)),linear-gradient(0deg,#000,transparent 58%)';
  hero.style.backgroundImage = heroOverlay;
  setFirstAvailableArtwork(hero, heroArtworkCandidates(h), url => {
    hero.style.backgroundImage = url ? `${heroOverlay},url("${String(url).replace(/"/g,'%22')}")` : heroOverlay;
  });
  $('heroTitle').textContent = h.title;
  $('heroDesc').textContent = h.desc || '';
  const badges = [];
  if (h.score) badges.push(`★ ${Number(h.score).toFixed(1)}`);
  if (h.year) badges.push(String(h.year));
  badges.push(h.type === 'anime' ? 'Anime' : h.type === 'tv' ? 'Series' : 'Movie');
  $('heroBadge').innerHTML = badges.map(b => `<span>${b}</span>`).join('');
  const heroMedia = heroMediaFor(h);
  $('heroPlay').onclick = () => playItem(heroMedia);
  $('heroMore').onclick = () => openDetails(heroMedia);
  const heroListBtn = $('heroList');
  if (heroListBtn) {
    const syncHeroList = () => {
      const on = isSaved(heroMedia);
      heroListBtn.classList.toggle('saved', on);
      heroListBtn.innerHTML = on ? '<i class="ri-check-line" aria-hidden="true"></i>' : '<i class="ri-add-line" aria-hidden="true"></i>';
      heroListBtn.title = on ? 'In My List' : 'Add to My List';
      heroListBtn.setAttribute('aria-label', heroListBtn.title);
    };
    heroListBtn.onclick = () => { toggleSaved(heroMedia); syncHeroList(); };
    syncHeroList();
  }
  $('heroDots').innerHTML = heroItems.map((_, idx) =>
    `<div class="hero-dot ${idx === heroIdx ? 'active' : ''}" onclick="renderHero(${idx});startHeroRotate()"></div>`
  ).join('');
  // MovieBox-style moving banner: swap in this slide's clip. The NEXT slide's
  // clip is already booting in the background, so the incoming one appears
  // already loaded instead of buffering in front of the user.
  if (typeof window.mountHeroTrailer === 'function') {
    window.mountHeroTrailer(h.type === 'anime' && h.raw && h.raw.trailer ? h.raw : heroMedia);
  }
  if (heroItems.length > 1 && typeof window.prefetchHeroTrailer === 'function') {
    const nxt = heroItems[(heroIdx + 1) % heroItems.length];
    window.prefetchHeroTrailer(nxt.type === 'anime' && nxt.raw && nxt.raw.trailer ? nxt.raw : heroMediaFor(nxt));
  }
}

function startHeroRotate() {
  clearInterval(heroTimer);
  if (heroItems.length < 2) return;
  heroTimer = setInterval(() => renderHero(heroIdx + 1), window.matchMedia('(max-width: 860px)').matches ? 15000 : 10000); // slower swap on phones: each swap loads a new player
}

/* Hero swipe (touch + mouse drag) */
(function setupHeroSwipe() {
  const el = () => $('hero');
  let startX = 0, startY = 0, tracking = false;
  function onStart(x, y) { startX = x; startY = y; tracking = true; }
  function onEnd(x, y) {
    if (!tracking) return;
    tracking = false;
    const dx = x - startX, dy = y - startY;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) renderHero(heroIdx + 1);
    else renderHero(heroIdx - 1);
    startHeroRotate();
  }
  document.addEventListener('DOMContentLoaded', () => {});
  // bind when hero exists
  setTimeout(() => {
    const h = el();
    if (!h) return;
    h.addEventListener('touchstart', e => onStart(e.changedTouches[0].clientX, e.changedTouches[0].clientY), { passive: true });
    h.addEventListener('touchend', e => onEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY), { passive: true });
    h.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') onStart(e.clientX, e.clientY); });
    h.addEventListener('pointerup', e => { if (e.pointerType === 'mouse') onEnd(e.clientX, e.clientY); });
  }, 0);
})();


function browseDisplayTitle() {
  if (browseMode === 'anime' && !browseGenre) return 'Anime';
  if (browseMode === 'movies') return catLabel(browseGenre || '') ? `${catLabel(browseGenre)} Movies` : 'Movies';
  if (browseMode === 'series') return catLabel(browseGenre || '') ? `${catLabel(browseGenre)} Series` : 'Series';
  if (browseMode === 'genre' || (browseMode === 'anime' && browseGenre)) return catLabel(browseGenre || '') || 'Category';
  return 'Category';
}
/* The domain the header art/poster should come from (hub + shelves included). */
function browseHeaderDomain() {
  if (browseMode === 'anime' || browseMode === 'genre') return 'anime';
  return browseMode;
}
function refreshBrowseHeader(isLoading=false) {
  const domain = browseHeaderDomain();
  const title = browseDisplayTitle();
  const eyebrow = domain === 'movies' ? 'THE MOVIE COLLECTION' : domain === 'series' ? 'SERIES & SEASONS' : 'THE ANIME UNIVERSE';
  const descriptions = domain === 'movies'
    ? (browseGenre && browseGenre !== 'New' && browseMode === 'movies' ? `Explore ${browseGenre.toLowerCase()} movies, hand-picked from the catalog.` : 'Big-screen stories, fresh releases, and films worth staying up for.')
    : domain === 'series' ? 'Find a new world to return to, episode after episode.'
    : (browseGenre && browseMode === 'genre' ? `Explore ${browseGenre.toLowerCase()} worlds, standout favorites, and new discoveries.` : 'From new-season standouts to timeless favorites, start your next watch here.');
  $('browseTitle').textContent = title;
  $('browseIntro').textContent = descriptions;
  const count = $('browseCount');
  if (count) count.innerHTML = isLoading ? '<i class="ri-loader-4-line" aria-hidden="true"></i> Loading titles' : `<i class="ri-film-line" aria-hidden="true"></i> ${browseItems.length || 0} title${browseItems.length===1?'':'s'} loaded`;
  const expectedType = domain === 'movies' ? 'movie' : domain === 'series' ? 'tv' : 'anime';
  const pool = [...(browseItems || []), ...(domain === 'movies' ? [...movieCache, ...(homeCollections.moviesPop || []), ...(homeCollections.moviesNew || [])] : domain === 'series' ? [...seriesCache, ...(homeCollections.series || [])] : [...(homeCollections.animeTrend || []), ...(homeCollections.animePop || [])]), ...Array.from(mediaRegistry.values())];
  const candidates = [];
  for (const item of pool) {
    if ((item._type || item.type || 'anime') !== expectedType) continue;
    const imdb = item.imdb && String(item.imdb).startsWith('tt') ? item.imdb : '';
    candidates.push(item.bannerImage, item._backdrop, imdb ? `https://images.metahub.space/background/medium/${imdb}/img` : '', ...posterCandidates(item));
    if (candidates.filter(Boolean).length >= 12) break;
  }
  const browseHero = $('browseHero');
  setFirstAvailableArtwork(browseHero, uniqueArtworkUrls(candidates), image => {
    browseHero.style.setProperty('--browse-image', image ? `url("${String(image).replace(/"/g,'%22')}")` : 'none');
  });
  // Portrait poster beside the hero (individual pages only: the hero is hidden on
  // the Category hub and genre shelves).
  const posterBox = $('browsePoster');
  if (posterBox && browseHero.style.display !== 'none') {
    let posterItem = null;
    for (const item of pool) {
      if ((item._type || item.type || 'anime') !== expectedType) continue;
      const img = posterCandidates(item).filter(Boolean)[0];
      if (img) { posterItem = img; break; }
    }
    if (posterItem) posterBox.innerHTML = `<img src="${escAttr(posterItem)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'">`;
  }
}
// ---- Individual-page poster rotation ----
// The main pages (Movies / Series) refresh their top poster on a random 1-20
// minute clock; sub-category pages (/movies/Horror etc. — every sub category has
// its own poster) refresh faster, every 1-5 minutes. The Category hub stays still.
let browsePosterTimer = null, browsePosterCursor = 0, landingPool = [];
function posterPoolForBrowse() {
  const domain = browseHeaderDomain();
  const wantType = domain === 'movies' ? 'movie' : domain === 'series' ? 'tv' : 'anime';
  let items = (browseItems.length ? browseItems : landingPool).filter(it => (it._type || it.type || 'anime') === wantType);
  if (browseGenre && ['movies', 'series'].includes(browseMode)) {
    const g = String(browseGenre).toLowerCase();
    const matched = items.filter(it => (it._genres || []).some(x => String(x).toLowerCase() === g));
    if (matched.length >= 3) items = matched; // a Horror page keeps showing Horror posters
  }
  return items.filter(it => posterCandidates(it).filter(Boolean)[0]);
}
function paintBrowsePoster(item) {
  if (!item) return;
  const img = posterCandidates(item).filter(Boolean)[0];
  if (!img) return;
  const imdb = item.imdb && String(item.imdb).startsWith('tt') ? item.imdb : '';
  const art = item.bannerImage || item._backdrop || (imdb ? `https://images.metahub.space/background/medium/${imdb}/img` : '') || img;
  const box = $('browsePoster');
  if (box) box.innerHTML = `<img src="${escAttr(img)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'">`;
  $('browseHero').style.setProperty('--browse-image', `url("${String(art).replace(/"/g, '%22')}")`);
}
function rotateBrowsePoster() {
  if (!['movies', 'series', 'anime'].includes(browseMode)) return; // left the page: stay quiet
  if (document.hidden) { scheduleBrowsePoster(); return; }
  const pool = posterPoolForBrowse();
  if (pool.length > 1) {
    browsePosterCursor = (browsePosterCursor + 1) % pool.length;
    paintBrowsePoster(pool[browsePosterCursor]);
  }
  scheduleBrowsePoster();
}
function scheduleBrowsePoster() {
  clearTimeout(browsePosterTimer);
  if (!['movies', 'series', 'anime'].includes(browseMode)) return;
  const subPage = !!browseGenre && browseGenre !== 'New' && browseGenre !== 'Popular' && browseGenre !== '';
  const wait = subPage
    ? 60000 + Math.random() * 240000      // sub categories: 1-5 minutes
    : 60000 + Math.random() * 1140000;    // main pages: 1-20 minutes
  browsePosterTimer = setTimeout(rotateBrowsePoster, wait);
}
function sortBrowse(mode) {  const items = [...browseItems];
  const rating = m => Number(m.averageScore || m.score || m.rating?.average || (String(m._sub||'').match(/★\s*([\d.]+)/)||[])[1] || 0);
  if (mode === 'score') items.sort((a,b) => rating(b)-rating(a));
  else if (mode === 'az') items.sort((a,b) => (a._title||'').localeCompare(b._title||''));
  else if (mode === 'year') items.sort((a,b) => Number(b._year || b.seasonYear || (b.premiered||'').slice(0,4) || 0)-Number(a._year || a.seasonYear || (a.premiered||'').slice(0,4) || 0));
  if (typeof resetGridAds === 'function') resetGridAds(); // full repaint rebuilds the ad rhythm
  $('browseGrid').innerHTML = items.length ? items.map(cardHTML).join('') : '<div class="state">No titles to sort yet.</div>';
}
function surpriseMe() {
  let pool = browseItems;
  if (!pool.length) {
    const desired = browseMode === 'movies' ? 'movie' : browseMode === 'series' ? 'tv' : 'anime';
    pool = Array.from(mediaRegistry.values()).filter(item => (item._type || item.type || 'anime') === desired);
  }
  if (!pool.length) return;
  openDetails(pool[Math.floor(Math.random() * pool.length)]);
}
function setCollectionArt(items) {
  const urls = [];
  for (const item of (items || []).slice(0, 8)) {
    const imdb = item.imdb && String(item.imdb).startsWith('tt') ? item.imdb : '';
    urls.push(item.bannerImage, item._backdrop, imdb ? `https://images.metahub.space/background/medium/${imdb}/img` : '', ...posterCandidates(item));
  }
  document.querySelectorAll('.collection-hero').forEach(el => setFirstAvailableArtwork(el, uniqueArtworkUrls(urls), image => el.style.setProperty('--collection-image', image ? `url("${String(image).replace(/"/g,'%22')}")` : 'none')));
}

async function loadBrowse(reset, requestId = browseRequestId) {
  if (requestId !== browseRequestId || browseLoading) return;
  browseLoading = true;
  $('browseToolbar').classList.remove('hidden');
  $('browseGrid').classList.remove('hidden');
  $('browseRows').innerHTML = '';
  $('loadMoreBtn').disabled = true;
  if (!reset && infiniteMode()) $('browseMoreState').classList.remove('hidden');
  try {
    let batch = [], hasMore = false;
    if (browseMode === 'anime' || browseMode === 'genre') {
      const d = await animeQuery(browseGenre || 'Popular', browsePage);
      batch = (d.Page.media || []).map(mapAnime);
      hasMore = !!d.Page.pageInfo?.hasNextPage;
    } else if (browseMode === 'movies') {
      const cat = browseGenre || 'New';
      if (cat === 'New') {
        batch = await fetchNewMovies(browsePage);
        const pages = batch._pages || 5;
        hasMore = batch.length > 0 && browsePage < pages;
      } else if (cat === 'Popular') {
        batch = browsePage === 1 ? await fetchCinemetaMovies() : await fetchCinemetaMovies(`skip=${browseSkip || (browsePage-1)*50}`);
        hasMore = batch.length >= 24;
      } else {
        const extra = browseSkip > 0 ? `genre=${encodeURIComponent(cat)}&skip=${browseSkip}` : `genre=${encodeURIComponent(cat)}`;
        batch = await fetchCinemetaMovies(extra);
        hasMore = batch.length >= 40;
      }
    } else if (browseMode === 'series') {
      const cat = browseGenre || 'Popular';
      if (browsePage === 1 && cat === 'Popular') {
        batch = seriesCache.length ? seriesCache : await fetchTvmazePopular();
        seriesCache = batch;
      } else {
        // Sub-category pages keep loading as you scroll: the ranked genre feed
        // supports skip paging.
        batch = await fetchCinemetaCatalog('series', cat, browseSkip > 0 ? browseSkip : 0);
      }
      hasMore = !((browsePage === 1 && cat === 'Popular')) && batch.length >= 40;
    }
    if (requestId !== browseRequestId) return;
    if (reset) browseItems = batch;
    else browseItems = browseItems.concat(batch);
    browseHasMore = hasMore;
    const seen = new Set();
    browseItems = browseItems.filter(it => {
      const k = it._type + ':' + (it.id || it.imdb || it._title);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    if (browseItems.length) sortBrowse($('browseSort')?.value || 'default');
    else $('browseGrid').innerHTML = '<div class="state">No results</div>';
    refreshBrowseHeader(false);
    scheduleBrowsePoster();
    $('loadMoreBtn').classList.toggle('hidden', !browseHasMore || infiniteMode());
    $('loadMoreBtn').innerHTML = '<i class="ri-add-line" aria-hidden="true"></i> Load more';
  } catch (e) {
    if (requestId === browseRequestId) {
      $('browseGrid').innerHTML = `<div class="state error">${e.message}</div>`;
      $('loadMoreBtn').classList.add('hidden');
    }
  } finally {
    if (requestId === browseRequestId) {
      browseLoading = false;
      $('loadMoreBtn').disabled = false;
      $('browseMoreState').classList.add('hidden');
      setTimeout(maybeLoadMore, 60);
    }
  }
}
function loadMoreBrowse() {
  if (browseLoading || !browseHasMore) return;
  if (browseMode === 'movies' && browseGenre && browseGenre !== 'New') browseSkip += 50;
  else if (browseMode === 'series' && browseGenre && browseGenre !== 'Popular') browseSkip += 50;
  else browsePage += 1;
  loadBrowse(false, browseRequestId);
}

async function loadBrowseLanding(requestId = browseRequestId) {
  const view = $('browseRows');
  const grid = $('browseGrid');
  const toolbar = $('browseToolbar');
  grid.classList.add('hidden');
  toolbar.classList.add('hidden');
  $('loadMoreBtn').classList.add('hidden');
  view.innerHTML = '<div class="state"><i class="ri-loader-4-line" aria-hidden="true"></i> Curating your shelves…</div>';
  let landingArtItems = [];
  const hubDomain = browseMode;
  $('browseIntro').textContent = hubDomain === 'movies' ? 'Films by genre, from new releases to popular picks.' : hubDomain === 'series' ? 'Series by genre, from new releases to popular picks.' : 'Anime by genre, from current seasons to all-time favorites.';
  try {
    let rows = '';
    if (hubDomain === 'movies') {
      // New + Popular load immediately, then every movie category (Action … 18 Plus)
      // gets its own lazy shelf that fills exactly like the anime category page.
      const groups = [
        ['New <em>Movies</em>', 'moviesNew', 'New'], ['Popular <em>Movies</em>', 'moviesPop', 'Popular'],
        ['Action <em>Movies</em>', 'movAction', 'Action'], ['Comedy <em>Movies</em>', 'movComedy', 'Comedy'],
        ['Animation <em>Movies</em>', 'movAni', 'Animation'], ['Adventure <em>Movies</em>', 'movAdv', 'Adventure']
      ];
      const fallbackByKey = { moviesNew:()=>fetchNewMovies(1), moviesPop:()=>fetchCinemetaMovies(), movAction:()=>fetchCinemetaMovies('genre=Action'), movComedy:()=>fetchCinemetaMovies('genre=Comedy'), movAni:()=>fetchCinemetaMovies('genre=Animation'), movAdv:()=>fetchCinemetaCatalog('movie', 'Adventure') };
      const loaded = await Promise.all(groups.map(async ([,key]) => homeCollections[key]?.length ? homeCollections[key] : fallbackByKey[key]().catch(()=>[])));
      landingArtItems = loaded.flat();
      groups.forEach(([title,key,genre],i) => { if (loaded[i]?.length) rows += rowHTML(title, loaded[i].slice(0,24), 'movies', 'browse_' + key, genre); });
      const usedGenres = new Set(['Action','Comedy','Animation','Adventure']);
      MOVIE_CATEGORIES.forEach(g => { if (!usedGenres.has(g)) rows += catSkeleton(g, 'movie'); });
    } else if (hubDomain === 'series') {
      const shows = seriesCache.length ? seriesCache : await fetchTvmazePopular();
      seriesCache = shows;
      landingArtItems = shows;
      rows += rowHTML('Popular <em>Series</em>', shows.slice(0,24), 'series', 'browse_series_popular', 'Popular');
      SERIES_CATEGORIES.forEach(g => { rows += catSkeleton(g, 'series'); });
    } else {
      rows = CATEGORIES.map(g => catSkeleton(g, 'anime')).join('');
      landingArtItems = [...(homeCollections.animeTrend || []), ...(homeCollections.animePop || [])];
      if (!landingArtItems.length) landingArtItems = await anilist(Q_ANIME_TREND, { page: 1 }).then(d => (d.Page.media || []).map(mapAnime)).catch(() => []);
    }
    if (requestId !== browseRequestId) return;
    landingPool = landingArtItems.slice(0, 60); // poster rotation pool for this page
    view.innerHTML = rows || '<div class="state">We could not load these shelves right now. Please try again in a moment.</div>';
    observeCatRows(view);
    scheduleBrowsePoster();
    const wantedType = hubDomain === 'movies' ? 'movie' : hubDomain === 'series' ? 'tv' : 'anime';
    const candidates = landingArtItems.filter(item => (item._type || item.type || 'anime') === wantedType);
    let artItem = candidates.find(item => hubDomain === 'anime' ? (item.bannerImage || item._backdrop || item._poster) : (item._backdrop || item.imdb || item.bannerImage || item._poster));
    if (!artItem) {
      const matchHero = heroItems.find(item => item.type === wantedType && item.backdrop);
      if (matchHero) artItem = wantedType === 'anime' ? { bannerImage: matchHero.backdrop } : { _backdrop: matchHero.backdrop };
    }
    let art = artItem ? (hubDomain === 'anime' ? (artItem.bannerImage || artItem._backdrop || artItem._poster) : (artItem._backdrop || (artItem.imdb ? `https://images.metahub.space/background/medium/${artItem.imdb}/img` : '') || artItem.bannerImage || artItem._poster)) : '';
    // The Category hub has no poster/head art; individual pages keep theirs.
    $('browseHero').style.setProperty('--browse-image', (art ? `url("${String(art).replace(/"/g,'%22')}")` : 'none'));
  } catch (error) {
    if (requestId !== browseRequestId) return;
    console.warn('Browse shelves failed', error);
    view.innerHTML = '<div class="state">Could not load catalog shelves. Please try again.</div>';
  }
}

function mediaFromHero(h) {
  if (!h) return null;
  if (h.type === 'anime') return { ...(h.raw || {}), _type:'anime', id:h.id, idMal:h.mal, _title:h.title, episodes:h.episodes, bannerImage:h.backdrop, description:h.desc, seasonYear:h.year, averageScore:h.score ? h.score * 10 : null };
  if (h.type === 'movie') return { _type:'movie', id:h.imdb || h.tmdb, tmdb:h.tmdb, imdb:h.imdb, _title:h.title, _backdrop:h.backdrop, summary:h.desc, _sub:h.year || 'Movie' };
  return { _type:'tv', id:h.tvmaze || h.imdb, imdb:h.imdb, tvmaze:h.tvmaze, _title:h.title, _poster:h.backdrop, _backdrop:h.backdrop, summary:h.desc, _sub:h.year || 'Series' };
}
