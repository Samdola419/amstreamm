/* Left guide drawer (YouTube-style) */
function toggleDrawer() {
  const drawer = $('ytDrawer'), backdrop = $('drawerBackdrop');
  if (!drawer || !backdrop) return;
  const open = !drawer.classList.contains('open');
  drawer.classList.toggle('open', open);
  backdrop.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}
function closeDrawer() {
  $('ytDrawer')?.classList.remove('open');
  $('drawerBackdrop')?.classList.remove('open');
  document.body.style.overflow = '';
}
/* Nav search field hands off to the full search screen */
function navSearchOpen() {
  const input = $('searchInput');
  if (input) input.value = '';
  openSearch();
}
/* Circular add button on every poster card */
function cardAddToggle(btn, key) {
  const item = mediaRegistry.get(key);
  if (!item) return;
  const now = toggleSaved(item);
  btn.classList.toggle('saved', now);
  btn.innerHTML = now ? '<i class="ri-check-line" aria-hidden="true"></i>' : '<i class="ri-add-line" aria-hidden="true"></i>';
  const label = now ? 'In My List' : 'Add to My List';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const drawer = $('ytDrawer');
    if (drawer && drawer.classList.contains('open')) closeDrawer();
  }
});
function showPage(id) {
  currentScreenId = id;
  ['homeView', 'browseView', 'playerView', 'detailView', 'myListView', 'continueView', 'mangaView', 'readerView'].forEach(pid => {
    const el = $(pid);
    if (!el) return;
    if (pid === id) {
      el.classList.remove('hidden-page');
      requestAnimationFrame(() => el.classList.add('active'));
    } else {
      el.classList.remove('active');
      setTimeout(() => { if (!el.classList.contains('active')) el.classList.add('hidden-page'); }, 280);
    }
  });
  if (id !== 'playerView' && $('player').getAttribute('src')) setPlayerSrc('');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.body.classList.toggle('no-side', id === 'playerView' || id === 'readerView' || id === 'detailView');
  syncBannerAd(id);
  syncTopNavContext(id);
}

/* In-app history. Each screen is a history entry, and a guard entry is
   pushed again on Back so the browser cannot leave the site. */
let applyingHistory = false;
const histStack = [{ kind: 'home' }];


function routeType(type) {
  return type === 'tv' ? 'tv' : type === 'movie' ? 'movie' : type === 'anime' ? 'anime' : type;
}
function routeIdentifier(media, type) {
  const m = media || {};
  if (type === 'anime') return m.ani_id || m.id || m.aniId || '';
  if (type === 'movie') return m.imdb || m.id || m.tmdb || '';
  if (type === 'tv') return m.tvmaze || m.id || m.imdb || '';
  return m.id || '';
}
function routeForEntry(entry) {
  if (!entry || entry.kind === 'home') return '/';
  if (entry.kind === 'browse') {
    const mode = entry.mode === 'genre' ? 'anime' : entry.mode;
    if (entry.genre) return `/${mode}/genre/${encodeURIComponent(entry.genre)}`;
    return `/${mode}`;
  }
  if (entry.kind === 'mylist') return '/my-list';
  if (entry.kind === 'continue') return '/continue-watching';
  if (entry.kind === 'detail' && entry.media) {
    const type = routeType(entry.media._type || entry.media.type || 'anime');
    const id = routeIdentifier(entry.media, type);
    return id ? `/title/${type}/${encodeURIComponent(id)}` : '/';
  }
  if (entry.kind === 'player') {
    const type = routeType(entry.playerType || 'anime');
    const id = type === 'movie' ? (entry.imdb || entry.tmdb) : type === 'tv' ? (entry.tvmaze || entry.imdb) : entry.aniId;
    return id ? `/watch/${type}/${encodeURIComponent(id)}` : '/watch';
  }
  if (entry.kind === 'reader' || entry.kind === 'comic') return '/manga';
  return '/';
}
function entryFromLocation() {
  const parts = location.pathname.split('/').filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch (_) { return part; } });
  if (!parts.length) return { kind: 'home' };
  if (parts[0] === 'movies') return { kind: 'browse', mode: 'movies', genre: parts[1] === 'genre' ? (parts[2] || null) : null };
  if (parts[0] === 'series') return { kind: 'browse', mode: 'series', genre: parts[1] === 'genre' ? (parts[2] || null) : null };
  if (parts[0] === 'anime') return { kind: 'browse', mode: parts[1] === 'genre' ? 'genre' : 'anime', genre: parts[1] === 'genre' ? (parts[2] || null) : null };
  if (parts[0] === 'manga') return { kind: 'browse', mode: 'manga', genre: null };
  if (parts[0] === 'my-list') return { kind: 'mylist' };
  if (parts[0] === 'continue-watching') return { kind: 'continue' };
  if ((parts[0] === 'title' || parts[0] === 'watch') && parts[1] && parts[2]) return { kind: parts[0] === 'title' ? 'route-detail' : 'route-player', type: parts[1], id: parts[2] };
  const query = new URLSearchParams(location.search);
  if (query.get('t') && query.get('id')) return { kind: 'route-detail', type: query.get('t'), id: query.get('id') };
  return { kind: 'home' };
}
async function fetchRoutedMedia(type, id) {
  if (type === 'anime') {
    const data = await anilist(Q_ANIME_INFO, { id: Number(id) });
    return data?.Media ? mapAnime(data.Media) : null;
  }
  if (type === 'movie') {
    const response = await fetch(`${CINEMETA}/meta/movie/${encodeURIComponent(id)}.json`);
    if (!response.ok) throw new Error('Could not load this movie.');
    const data = await response.json();
    return data.meta ? mapCinemetaMovie({ ...data.meta, imdb_id: data.meta.imdb_id || id }) : null;
  }
  if (type === 'tv') {
    const url = /^\d+$/.test(String(id)) ? `${TVMAZE}/shows/${encodeURIComponent(id)}` : `${TVMAZE}/lookup/shows?imdb=${encodeURIComponent(id)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load this series.');
    return mapTvmaze(await response.json());
  }
  return null;
}
async function hydrateInitialRoute(entry) {
  if (!entry || entry.kind === 'home') return;
  if (entry.kind === 'browse') { nav(entry.mode, entry.genre, true); return; }
  if (entry.kind === 'mylist') { openMyList(true); return; }
  if (entry.kind === 'continue') { openContinue(true); return; }
  if (entry.kind === 'route-detail' || entry.kind === 'route-player') {
    try {
      const media = await fetchRoutedMedia(entry.type, entry.id);
      if (!media) throw new Error('This title could not be found.');
      if (entry.kind === 'route-detail') openDetails(media, true);
      else { applyingHistory = true; try { playItem(media); } finally { applyingHistory = false; } }
    } catch (error) {
      showPage('homeView');
      $('homeRows').insertAdjacentHTML('afterbegin', `<div class="state error route-error">${escHtml(error.message || 'This page could not be loaded.')}</div>`);
    }
  }
}

function seedHistory() {
  const state = { app: 1, i: 0 };
  const currentUrl = location.pathname + location.search;
  history.replaceState(state, '', currentUrl);
  history.pushState(state, '', currentUrl);
  histStack[0].pos = history.length - 1;
}
function pushHist(entry) {
  if (applyingHistory) return;
  histStack.push(entry);
  history.pushState({ app: 1, i: histStack.length - 1 }, '', routeForEntry(entry));
  entry.pos = history.length - 1; // where this page sits in the browser history
}
function rearmHistory() {
  history.pushState({ app: 1, i: Math.max(0, histStack.length - 1) }, '', location.href);
  if (histStack.length) histStack[histStack.length - 1].pos = history.length - 1;
}
function applyHist(entry) {
  applyingHistory = true;
  try {
    if (!entry || entry.kind === 'home') {
      browseMode = null;
      browseGenre = null;
      setNav('home');
      closeSearch();
      showPage('homeView');
    } else if (entry.kind === 'browse') {
      nav(entry.mode, entry.genre, true);
    } else if (entry.kind === 'player') {
      if (entry.playerType === 'movie') openMovie(entry.tmdb, entry.imdb, entry.title, true);
      else if (entry.playerType === 'tv') openTv(entry.imdb, entry.tvmaze, entry.title, true);
      else openAnime(entry.aniId, entry.malId, entry.title, entry.episodes, true);
    } else if (entry.kind === 'detail' && entry.media) {
      openDetails(entry.media, true);
    } else if (entry.kind === 'reader' && entry.media) {
      readManga(entry.media, entry.chapterId, true);
    } else if (entry.kind === 'comic' && entry.media) {
      readComic(entry.media, true);
    } else if (entry.kind === 'mylist') {
      openMyList(true);
    } else if (entry.kind === 'continue') {
      openContinue(true);
    }
  } finally {
    applyingHistory = false;
  }
}
window.addEventListener('popstate', () => {
  if ($('searchOverlay')?.classList.contains('show')) {
    closeSearch();
    rearmHistory();
    return;
  }
  if (histStack.length > 1) histStack.pop();
  applyHist(histStack[histStack.length - 1]);
  rearmHistory();
});
// Video sites inside the player add their own history entries, so one plain history.back() can land on one of theirs
// and the page looks unchanged. Jump straight to this app's previous page instead, however many entries sit in between.
function appBack() {
  const target = histStack[histStack.length - 2];
  if (!target) { nav('home'); return; }
  let steps = target && Number.isInteger(target.pos) ? (history.length - 1) - target.pos : 1;
  if (steps < 1 || steps > history.length - 1) steps = 1;
  history.go(-steps);
}
function goHome() { nav('home'); }
const CATEGORIES = ['Trending','Popular','Comedy','Romance','Action','Fantasy','Adventure','Drama','Sci-Fi','Slice of Life','Supernatural','Mystery','Horror','Psychological','Sports','Mahou Shoujo','Mecha','Music','Thriller','Ecchi','Hentai'];
const HOME_KEY = { Trending:'animeTrend', Popular:'animePop', Comedy:'comedy', Romance:'romance', Action:'action' };
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
  sec.dataset.state = 'loading';
  const key = HOME_KEY[genre];
  const p = key && homeCollections[key]?.length ? Promise.resolve(homeCollections[key]) : animeQuery(genre, 1).then(d => (d.Page.media || []).map(mapAnime));
  p.then(items => {
    if (!sec.isConnected) return;
    if (!items.length) { sec.remove(); return; }
    const wrap = document.createElement('div');
    wrap.innerHTML = rowHTML(`<em>${genre}</em>`, items.slice(0,24), 'genre', 'cat_' + genre.replace(/\W/g,''), genre);
    sec.replaceWith(wrap.firstElementChild);
  }).catch(() => { sec.dataset.state = ''; sec.querySelector('.cat-slot').textContent = 'Could not load. Scroll to retry.'; });
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
function catSkeleton(genre) {
  return `<section class="section cat-lazy" data-genre="${genre}"><div class="section-head"><h2 class="section-title"><em>${genre}</em></h2><button class="section-more" onclick="nav('genre','${genre}')">View All <i class="ri-arrow-right-s-line" aria-hidden="true"></i></button></div>` +
    `<div class="state cat-slot">Loading…</div></section>`;
}
function nav(mode, genre, silent) {
  if (NAV_ON[mode === 'genre' ? 'anime' : mode] === false) mode = 'home';
  setNav(mode === 'genre' ? 'anime' : mode);
  closeSearch();
  if (!silent) {
    if (mode === 'home') pushHist({ kind: 'home' });
    else pushHist({ kind: 'browse', mode, genre: genre || null });
  }
  if (mode === 'home') { browseMode = null; browseGenre = null; showPage('homeView'); return; }
  if (mode === 'mylist') { openMyList(true); return; }
  if (mode === 'continue') { openContinue(true); return; }
  if (mode === 'manga') { openManga(genre); return; }
  showPage('browseView');
  const catMode = mode === 'anime' || mode === 'genre';
  $('browseHero').style.display = catMode ? 'none' : '';
  $('catHead').classList.toggle('hidden', !catMode);
  $('catHeadTitle').textContent = genre || 'Category';
  browseMode = mode;
  browseGenre = genre || null;
  browsePage = 1;
  browseSkip = 0;
  browseItems = [];
  browseHasMore = true;
  browseLoading = false;
  const requestId = ++browseRequestId;
  const titles = {
    movies: browseGenre ? `${browseGenre} Movies` : 'Movies',
    series: browseGenre ? `${browseGenre} Series` : 'Series',
    anime: genre || 'Category', genre: genre || 'Category'
  };
  $('browseTitle').textContent = titles[mode] || mode;
  refreshBrowseHeader(true);
  const sort=$('browseSort'); if(sort) sort.value='default';
  $('browseBar').innerHTML = '';
  $('browseRows').innerHTML = '';
  $('browseGrid').innerHTML = '<div class="state">Loading…</div>';
  $('loadMoreBtn').classList.add('hidden');
  if (!browseGenre && ['movies','series','anime'].includes(mode)) loadBrowseLanding(requestId);
  else loadBrowse(true, requestId);
}

async function loadHome() {
  const rowsEl = $('homeRows');
  rowsEl.innerHTML = '<div class="state">Loading your first picks…</div>';
  // Paint the homepage after the three most useful feeds arrive; don't hold the whole page
  // hostage while every genre catalog finishes loading.
  const state = { animeTrend: [], animePop: [], moviesNew: [], moviesPop: [], movAction: [], movComedy: [], movAni: [], movAdv: [], series: [], romance: [], action: [], comedy: [], mangaTrend: [], mangaPop: [], comicTrend: [], comicPop: [] };
  const paintRows = () => {
    let html = '';
    const recent = allMedia(getContinueList());
    if (recent.length) html += rowHTML('Continue <em>Watching</em>', recent, null, 'continueRow');
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
    if ($('searchOverlay')?.classList.contains('show') && !$('searchInput').value.trim()) renderSearchIdle();
  };
  const toAnime = q => anilist(q.query, q.variables).then(d => (d.Page.media || []).map(mapAnime)).catch(() => []);
  let heroStarted = false;
  const updateCoreUI = () => {
    heroItems = [
      ...state.moviesPop.slice(0,4).map(m => ({ type:'movie', tmdb:m.tmdb, imdb:m.imdb, title:m._title, backdrop:m._backdrop||m._poster, desc:m.summary||'Discover this title and explore more details.', trailer:m.trailer, trailers:m.trailers, score:Number(String(m._sub??'').match(/★\s*([\d.]+)/)?.[1])||null, year:m._year||'' })),
      ...state.series.slice(0,3).map(s => ({ type:'tv', imdb:s.imdb, tvmaze:s.tvmaze, title:s._title, backdrop:s._backdrop||s._poster, desc:s.summary, trailer:s.trailer, trailers:s.trailers, score:Number(String(s._sub??'').match(/★\s*([\d.]+)/)?.[1])||null, year:(s.premiered||s._year||'').toString().slice(0,4) })),
      ...state.animeTrend.slice(0,3).map(m => ({ type:'anime', id:m.id, mal:m.idMal, title:m._title, raw:m, backdrop:m.bannerImage||m._poster, desc:stripHtml(m.description), score:m.averageScore?m.averageScore/10:null, year:m.seasonYear, episodes:m.episodes }))
    ].filter(h => h.title);
    if (heroItems.length) {
      renderHero(0); renderTrending();
      if (!heroStarted) { startHeroRotate(); heroStarted = true; }
    }
    homeCollections.moviesPop = state.moviesPop; homeCollections.animeTrend = state.animeTrend; homeCollections.series = state.series;
    seriesCache = state.series;
    paintRows();
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
        ? { _type:'movie', id:h.imdb||h.tmdb, tmdb:h.tmdb, imdb:h.imdb, _title:h.title, _backdrop:h.backdrop, summary:h.desc, _sub:h.year||'Movie', trailer:h.trailer||null, trailers:h.trailers||[] }
        : { _type:'tv', id:h.tvmaze||h.imdb, imdb:h.imdb, tvmaze:h.tvmaze, _title:h.title, _poster:h.backdrop, summary:h.desc, _sub:h.year||'Series', trailer:h.trailer||null, trailers:h.trailers||[] };
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

function trailerYoutubeId(item) {
  if (!item) return '';
  const candidates = [item.trailer, item.trailerId, item.youtubeTrailerId, ...(Array.isArray(item.trailers) ? item.trailers : []), ...(Array.isArray(item.videos) ? item.videos : [])];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'object') {
      const site = String(candidate.site || candidate.source || '').toLowerCase();
      const raw = candidate.id || candidate.key || candidate.url || candidate.link || '';
      if (site && !site.includes('youtube') && !String(raw).includes('youtube.com') && !String(raw).includes('youtu.be')) continue;
      const found = trailerYoutubeId({ trailerId: raw });
      if (found) return found;
      continue;
    }
    const value = String(candidate).trim();
    const urlMatch = value.match(/(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
    if (urlMatch) return urlMatch[1];
    if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  }
  return '';
}
const trailerLookupCache = new Map();
async function resolveTrailerId(item) {
  const direct = trailerYoutubeId(item);
  if (direct) return direct;
  if (!item) return '';
  const type = item._type || item.type || '';
  if (type === 'anime') return '';
  let imdb = item.imdb || (String(item.id || '').startsWith('tt') ? item.id : '');
  const lookupKey = `${type}:${imdb || item.tvmaze || item.id || item.tmdb || ''}`;
  if (trailerLookupCache.has(lookupKey)) return trailerLookupCache.get(lookupKey);
  const request = (async () => {
    try {
      if (!imdb && type === 'tv' && item.tvmaze) {
        const showResponse = await fetch(`${TVMAZE}/shows/${encodeURIComponent(item.tvmaze)}`);
        if (showResponse.ok) {
          const show = await showResponse.json();
          imdb = show.externals?.imdb || '';
          if (imdb) item.imdb = imdb;
        }
      }
      if (!imdb || !String(imdb).startsWith('tt')) return '';
      const kind = type === 'movie' ? 'movie' : type === 'tv' ? 'series' : '';
      if (!kind) return '';
      const response = await fetch(`${CINEMETA}/meta/${kind}/${encodeURIComponent(imdb)}.json`);
      if (!response.ok) return '';
      const payload = await response.json();
      const meta = payload?.meta || {};
      item.trailer = meta.trailer || item.trailer || null;
      item.trailers = meta.trailers || meta.videos || item.trailers || [];
      return trailerYoutubeId(meta);
    } catch (_) { return ''; }
  })();
  trailerLookupCache.set(lookupKey, request);
  return request;
}
function detailTrailerMarkup(title, trailerId) {
  if (!trailerId) return '';
  return `<section class="detail-trailer-card"><div class="detail-trailer-copy"><h2>Watch the trailer</h2><p>A preview for ${escHtml(title)}. The full title opens in the player.</p><a class="detail-trailer-link" href="https://www.youtube.com/watch?v=${encodeURIComponent(trailerId)}" target="_blank" rel="noopener noreferrer">Open trailer <i class="ri-arrow-up-right-line" aria-hidden="true"></i></a></div><iframe class="detail-trailer-frame" src="${youtubePreviewUrl(trailerId)}" title="${escAttr(title)} trailer" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" loading="lazy"></iframe></section>`;
}
function youtubePreviewUrl(id) {
  const q = new URLSearchParams({ autoplay: '1', mute: '1', controls: '0', loop: '1', playlist: id, playsinline: '1', modestbranding: '1', rel: '0', iv_load_policy: '3', disablekb: '1' });
  return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?' + q.toString();
}

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

let heroPreviewRequest = 0;
function renderHero(i) {
  if (!heroItems.length) return;
  heroIdx = ((i % heroItems.length) + heroItems.length) % heroItems.length;
  const h = heroItems[heroIdx];
  const hero = $('hero');
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
  const heroMedia = h.type === 'anime'
    ? { ...h.raw, _type:'anime', id:h.id, idMal:h.mal, _title:h.title, episodes:h.episodes, bannerImage:h.backdrop, description:h.desc, averageScore:h.score ? h.score*10 : null, seasonYear:h.year }
    : h.type === 'movie'
      ? { _type:'movie', id:h.imdb||h.tmdb, imdb:h.imdb, tmdb:h.tmdb, _title:h.title, _backdrop:h.backdrop, summary:h.desc, _sub:h.year||'Movie', trailer:h.trailer||null, trailers:h.trailers||[] }
      : { _type:'tv', id:h.tvmaze||h.imdb, imdb:h.imdb, tvmaze:h.tvmaze, _title:h.title, _poster:h.backdrop, summary:h.desc, _sub:h.year||'Series', trailer:h.trailer||null, trailers:h.trailers||[] };
  const heroTrailer = trailerYoutubeId(heroMedia);
  const heroPreview = $('heroPreview');
  const previewRequest = ++heroPreviewRequest;
  if (heroPreview) {
    heroPreview.replaceChildren();
    hero.classList.remove('has-preview');
    (async () => {
      const trailerId = heroTrailer || await resolveTrailerId(heroMedia);
      if (!trailerId || previewRequest !== heroPreviewRequest || !hero.isConnected) return;
      const frame = document.createElement('iframe');
      frame.src = youtubePreviewUrl(trailerId);
      frame.title = 'Featured trailer preview';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture';
      frame.tabIndex = -1;
      frame.setAttribute('aria-hidden', 'true');
      heroPreview.replaceChildren(frame);
      hero.classList.add('has-preview');
    })();
  }
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
}

function startHeroRotate() {
  clearInterval(heroTimer);
  if (heroItems.length < 2) return;
  heroTimer = setInterval(() => renderHero(heroIdx + 1), 7000);
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
  if (browseMode === 'movies') return browseGenre ? `${browseGenre} Movies` : 'Movies';
  if (browseMode === 'series') return browseGenre ? `${browseGenre} Series` : 'Series';
  if (browseMode === 'genre' || (browseMode === 'anime' && browseGenre)) return browseGenre || 'Category';
  return 'Category';
}
function refreshBrowseHeader(isLoading=false) {
  const title = browseDisplayTitle();
  const eyebrow = browseMode === 'movies' ? 'THE MOVIE COLLECTION' : browseMode === 'series' ? 'SERIES & SEASONS' : 'THE ANIME UNIVERSE';
  const descriptions = browseMode === 'movies'
    ? (browseGenre && browseGenre !== 'New' ? `Explore ${browseGenre.toLowerCase()} movies, hand-picked from the catalog.` : 'Big-screen stories, fresh releases, and films worth staying up for.')
    : browseMode === 'series' ? 'Find a new world to return to, episode after episode.'
    : browseGenre ? `Explore ${browseGenre.toLowerCase()} worlds, standout favorites, and new discoveries.` : 'From new-season standouts to timeless favorites, start your next watch here.';
  $('browseTitle').textContent = title;
  $('browseIntro').textContent = descriptions;
  if (browseMode === 'anime' || browseMode === 'genre') $('catHeadTitle').textContent = browseGenre || 'Category';
  const count = $('browseCount');
  if (count) count.innerHTML = isLoading ? '<i class="ri-loader-4-line" aria-hidden="true"></i> Loading titles' : `<i class="ri-film-line" aria-hidden="true"></i> ${browseItems.length || 0} title${browseItems.length===1?'':'s'} loaded`;
  const expectedType = browseMode === 'movies' ? 'movie' : browseMode === 'series' ? 'tv' : 'anime';
  const pool = [...(browseItems || []), ...(browseMode === 'movies' ? [...movieCache, ...(homeCollections.moviesPop || []), ...(homeCollections.moviesNew || [])] : browseMode === 'series' ? [...seriesCache, ...(homeCollections.series || [])] : [...(homeCollections.animeTrend || []), ...(homeCollections.animePop || [])]), ...Array.from(mediaRegistry.values())];
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
}
function sortBrowse(mode) {
  const items = [...browseItems];
  const rating = m => Number(m.averageScore || m.score || m.rating?.average || (String(m._sub||'').match(/★\s*([\d.]+)/)||[])[1] || 0);
  if (mode === 'score') items.sort((a,b) => rating(b)-rating(a));
  else if (mode === 'az') items.sort((a,b) => (a._title||'').localeCompare(b._title||''));
  else if (mode === 'year') items.sort((a,b) => Number(b._year || b.seasonYear || (b.premiered||'').slice(0,4) || 0)-Number(a._year || a.seasonYear || (a.premiered||'').slice(0,4) || 0));
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
      if (browsePage === 1) {
        batch = seriesCache.length ? seriesCache : await fetchTvmazePopular();
        seriesCache = batch;
      }
      if (browseGenre && browseGenre !== 'Popular') batch = batch.filter(m => (m.genres || []).some(g => String(g).toLowerCase() === browseGenre.toLowerCase()));
      hasMore = false;
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
  $('browseIntro').textContent = browseMode === 'movies' ? 'Films by genre, from new releases to popular picks.' : browseMode === 'series' ? 'Series by genre, from new releases to popular picks.' : 'Anime by genre, from current seasons to all-time favorites.';
  try {
    let rows = '';
    if (browseMode === 'movies') {
      const groups = [
        ['New <em>Movies</em>', 'moviesNew', 'New'], ['Popular <em>Movies</em>', 'moviesPop', 'Popular'],
        ['Action <em>Movies</em>', 'movAction', 'Action'], ['Comedy <em>Movies</em>', 'movComedy', 'Comedy'],
        ['Animation <em>Movies</em>', 'movAni', 'Animation'], ['Adventure <em>Movies</em>', 'movAdv', 'Adventure']
      ];
      const fallbackByKey = { moviesNew:()=>fetchNewMovies(1), moviesPop:()=>fetchCinemetaMovies(), movAction:()=>fetchCinemetaMovies('genre=Action'), movComedy:()=>fetchCinemetaMovies('genre=Comedy'), movAni:()=>fetchCinemetaMovies('genre=Animation'), movAdv:()=>fetchCinemetaMovies('genre=Adventure') };
      const loaded = await Promise.all(groups.map(async ([,key]) => homeCollections[key]?.length ? homeCollections[key] : fallbackByKey[key]().catch(()=>[])));
      landingArtItems = loaded.flat();
      groups.forEach(([title,key,genre],i) => { if (loaded[i]?.length) rows += rowHTML(title, loaded[i].slice(0,24), 'movies', 'browse_' + key, genre); });
    } else if (browseMode === 'series') {
      const shows = seriesCache.length ? seriesCache : await fetchTvmazePopular();
      seriesCache = shows;
      landingArtItems = shows;
      const cats = [['Popular <em>Series</em>',null],['Drama <em>Series</em>','Drama'],['Comedy <em>Series</em>','Comedy'],['Crime <em>Series</em>','Crime'],['Mystery <em>Series</em>','Mystery'],['Action & Adventure <em>Series</em>','Action']];
      cats.forEach(([title,genre],i) => {
        const items = genre ? shows.filter(m=>(m.genres||[]).some(g=>String(g).toLowerCase()===genre.toLowerCase() || (genre==='Action' && String(g).toLowerCase()==='adventure'))) : shows;
        if (items.length) rows += rowHTML(title,items.slice(0,24),'series','browse_series_'+(genre||'popular'),genre || 'Popular');
      });
    } else {
      rows = CATEGORIES.map(catSkeleton).join('');
      landingArtItems = [];
    }
    if (requestId !== browseRequestId) return;
    view.innerHTML = rows || '<div class="state">We could not load these shelves right now. Please try again in a moment.</div>';
    if (browseMode === 'anime') observeCatRows(view);
    const wantedType = browseMode === 'movies' ? 'movie' : browseMode === 'series' ? 'tv' : 'anime';
    const candidates = landingArtItems.filter(item => (item._type || item.type || 'anime') === wantedType);
    let artItem = candidates.find(item => browseMode === 'anime' ? (item.bannerImage || item._backdrop || item._poster) : (item._backdrop || item.imdb || item.bannerImage || item._poster));
    if (!artItem) {
      const matchHero = heroItems.find(item => item.type === wantedType && item.backdrop);
      if (matchHero) artItem = wantedType === 'anime' ? { bannerImage: matchHero.backdrop } : { _backdrop: matchHero.backdrop };
    }
    let art = artItem ? (browseMode === 'anime' ? (artItem.bannerImage || artItem._backdrop || artItem._poster) : (artItem._backdrop || (artItem.imdb ? `https://images.metahub.space/background/medium/${artItem.imdb}/img` : '') || artItem.bannerImage || artItem._poster)) : '';
    $('browseHero').style.setProperty('--browse-image', art ? `url("${String(art).replace(/"/g,'%22')}")` : 'none');
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
let searchFilter = 'all';
let searchData = { q: '', groups: null };
const SEARCH_LABELS = { all: 'titles', movie: 'movies', tv: 'series', anime: 'anime', manga: 'manga', comic: 'comics' };
function renderSearchIdle() {
  searchData = { q: '', groups: null };
  $('searchHint').textContent = '';
  $('searchResults').innerHTML = '';
}
function setSearchFilter(f) {
  searchFilter = f;
  document.querySelectorAll('#searchFilters button').forEach(b => b.classList.toggle('active', b.dataset.f === f));
  const q = $('searchInput').value.trim();
  if (q.length < 2) { renderSearchIdle(); return; }
  if (searchData.groups && searchData.q === q) renderSearchResults(); else runSearch(q);
}
function openSearch() {
  $('searchOverlay').classList.add('show');
  $('searchInput').value = '';
  renderSearchIdle();
  syncTopNavContext();
  setTimeout(() => $('searchInput').focus(), 40);
}
function closeSearch() {
  $('searchOverlay').classList.remove('show');
  $('searchInput').value = '';
  clearTimeout(searchTimer);
  syncTopNavContext();
}
function searchFor(q) {
  $('searchInput').value = q;
  runSearch(q);
  $('searchInput').focus();
}
$('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('searchInput').value.trim();
  if (q.length < 2) { renderSearchIdle(); return; }
  $('searchHint').textContent = 'Searching...';
  searchTimer = setTimeout(() => runSearch(q), 180);
});
$('searchInput').addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch(); });

function renderSearchResults() {
  const g = searchData.groups;
  if (!g) return;
  const types = searchFilter === 'all' ? ['anime', 'tv', 'movie', 'manga', 'comic'].filter(t => TYPE_ENABLED[t]) : [searchFilter];
  const seen = new Set(), unique = [];
  for (const t of types) {
    for (const it of (g[t] || [])) {
      const k = (it._type || t) + ':' + (it._title || '').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); unique.push(it);
    }
  }
  const shown = unique.slice(0, 60);
  $('searchResults').innerHTML = shown.length ? shown.map(cardHTML).join('') : '<div class="state">No matches. Try a shorter title or another spelling.</div>';
  $('searchHint').textContent = shown.length ? `${shown.length} ${shown.length === 1 ? SEARCH_LABELS[searchFilter].replace(/s$/, '') : SEARCH_LABELS[searchFilter]} found` : '';
}
async function runSearch(q) {
  $('searchHint').textContent = 'Searching...';
  const [anime, tv, movie, manga, comic] = await Promise.all([
    !TYPE_ENABLED.anime ? [] : anilist(Q_ANIME_SEARCH, { q }).then(d => (d.Page.media || []).map(mapAnime)).catch(() => []),
    !TYPE_ENABLED.tv ? [] : searchTvmaze(q).catch(() => []),
    !TYPE_ENABLED.movie ? [] : (async () => {
      const found = await fetchCinemetaMovies(`search=${encodeURIComponent(q)}`).catch(() => []);
      const ql = q.toLowerCase();
      const local = movieCache.filter(m => (m._title || '').toLowerCase().includes(ql));
      return [...found, ...local];
    })(),
    !TYPE_ENABLED.manga ? [] : fetchManga({ q }).catch(() => []),
    !TYPE_ENABLED.comic ? [] : fetchComics({ q }).catch(() => [])
  ]);
  if ($('searchInput').value.trim() !== q) return;
  searchData = { q, groups: { anime, tv, movie, manga, comic } };
  renderSearchResults();
}
