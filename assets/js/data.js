/* ----------------------------------------------------------------------
   AnimeStream catalog data: feeds (AniList / cinemeta / tvmaze), posters, media registry
   ---------------------------------------------------------------------- */
// ---- Sections: switch any of these to true to bring that section back (nav, home rows, search, lists). ----
const SECTIONS = { anime: true, movies: true, series: true, manga: false };
const TYPE_ENABLED = { anime: SECTIONS.anime, movie: SECTIONS.movies, tv: SECTIONS.series, manga: SECTIONS.manga, comic: SECTIONS.manga };
const NAV_ON = { home: true, category: SECTIONS.anime, anime: SECTIONS.anime, movies: SECTIONS.movies, series: SECTIONS.series, manga: SECTIONS.manga, mylist: true, continue: true, coming: true };
const ENABLED_TYPE_COUNT = Object.values(SECTIONS).filter(Boolean).length + (SECTIONS.manga ? 1 : 0);
const ANILIST = 'https://graphql.anilist.co';
const TVMAZE = 'https://api.tvmaze.com';
const CINEMETA = 'https://v3-cinemeta.strem.io';
const $ = id => document.getElementById(id);

// One client-side source for movies and series: vidsrc.pm's player. It is the one
// embed that keeps playing inside /megaplay.html's sandbox (no allow-popups, no
// top-navigation), so whatever pop-under it ships can never open a tab or redirect
// the site. Its native player accepts IMDB or TMDB ids for both movies and episodes.
const MOVIE_SERVERS = [
  { name: 'VidSrc', url: m => `https://vidsrc.pm/embed/movie/${m.tmdb || m.imdb}` },
];
const TV_SERVERS = [
  { name: 'VidSrc', url: (id,s,e) => `https://vidsrc.pm/embed/tv/${id}/${s}/${e}` },
];

// Anime playback: MegaPlay's catalogue resolves the episode from the MAL id (with
// the AniList id as a second route), and AniPub's API is only the last-resort listing.
// Playback is MegaPlay's own player through /megaplay.html with the partner-token
// referrer, so its redirect engine is never injected; sub/dub is the final path segment.
const ANIME_SERVERS = [
  { name: 'AniPub', url: (m, ep, lang) => animePlayerSrc(m, ep, lang) },
];
const ANIME_GENRES = ['Action','Romance','Comedy','Drama','Fantasy','Horror','Sci-Fi','Slice of Life','Sports','Supernatural','Mystery','Adventure'];
const MOVIE_CATS = ['New','Popular','Action','Comedy','Adventure','Animation','Sci-Fi','Fantasy','Family','Drama'];

let heroItems = [], heroIdx = 0, heroTimer = null;
let current = null, lang = 'sub', season = 1, epIndex = 0, serverIdx = 0;
let searchTab = 'all', searchTimer = null;
let movieCache = [], seriesCache = [];
let newMovieFallbackCache = null;
let homeCollections = {};
let browseMode = null, browsePage = 1, browseGenre = null, browseItems = [], browseHasMore = true;
let browseSkip = 0, browseLoading = false, browseRequestId = 0;
const mediaRegistry = new Map();
let mediaRegistryCounter = 0;
let activeDetail = null;
let listFilter = 'all';

const CATALOG_CACHE_TTL = 15 * 60 * 1000;
const catalogInFlight = new Map();
function readCatalogCache(key) {
  try { const raw = localStorage.getItem('animestream.catalog.v1:' + key); return raw ? JSON.parse(raw) : null; }
  catch (_) { return null; }
}
function writeCatalogCache(key, value) {
  try { localStorage.setItem('animestream.catalog.v1:' + key, JSON.stringify({ savedAt: Date.now(), value })); }
  catch (_) { /* Storage can be unavailable or full; network loading still works. */ }
}
async function cachedCatalog(key, loader, ttl = CATALOG_CACHE_TTL) {
  const cached = readCatalogCache(key);
  if (cached && Array.isArray(cached.value) || cached && cached.value && typeof cached.value === 'object') {
    if (Date.now() - cached.savedAt < ttl) return cached.value;
    // Stale-while-revalidate: show the last good catalog immediately and refresh for next visit.
    if (!catalogInFlight.has(key)) {
      const refresh = Promise.resolve().then(loader).then(value => { writeCatalogCache(key, value); return value; }).catch(() => cached.value).finally(() => catalogInFlight.delete(key));
      catalogInFlight.set(key, refresh);
    }
    return cached.value;
  }
  if (catalogInFlight.has(key)) return catalogInFlight.get(key);
  const request = Promise.resolve().then(loader).then(value => { writeCatalogCache(key, value); return value; }).finally(() => catalogInFlight.delete(key));
  catalogInFlight.set(key, request);
  return request;
}
async function anilist(query, variables = {}) {
  // A small concurrency cap: enough parallel lanes to keep a category page quick,
  // but never a burst large enough to trip AniList's rate limiting (which left
  // shelves stuck on "loading"). Failures retry with backoff.
  const key = 'anilist:' + query + ':' + JSON.stringify(variables);
  return cachedCatalog(key, async () => {
    await aniAcquire();
    try { return await postAnilist(query, variables); }
    finally { aniRelease(); }
  });
}
const ANI_MAX_PARALLEL = 5;
let aniActive = 0;
const aniQueue = [];
function aniAcquire() {
  if (aniActive < ANI_MAX_PARALLEL) { aniActive++; return Promise.resolve(); }
  return new Promise(res => aniQueue.push(res));
}
function aniRelease() {
  aniActive--;
  const next = aniQueue.shift();
  if (next) { aniActive++; next(); }
}
async function postAnilist(query, variables) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 700 * attempt + Math.random() * 500));
    const res = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (res.status === 429) {
      // The API tells us exactly how long to wait — honor it so sub-category
      // shelves stop dying on bursts.
      const wait = Number(res.headers.get('retry-after'));
      await new Promise(r => setTimeout(r, Number.isFinite(wait) && wait > 0 ? Math.min(wait * 1000, 15000) : 2000 + attempt * 1500));
      continue;
    }
    if (res.status === 500 || res.status === 502) continue; // transient: back off and retry
    if (!res.ok) throw new Error('AniList ' + res.status);
    const json = await res.json();
    if (json.errors && !json.data) throw new Error(json.errors[0]?.message || 'AniList error');
    return json.data;
  }
  throw new Error('AniList is rate-limited right now');
}

const Q_ANIME_TREND = `query($page:Int){Page(page:$page,perPage:24){pageInfo{hasNextPage} media(type:ANIME,sort:TRENDING_DESC,isAdult:false){id idMal title{romaji english} coverImage{large extraLarge} bannerImage averageScore genres episodes seasonYear trailer{id site} description(asHtml:false)}}}`;
const Q_ANIME_UPCOMING = `query($page:Int){Page(page:$page,perPage:24){pageInfo{hasNextPage} media(status:NOT_YET_RELEASED,sort:POPULARITY_DESC,isAdult:false){id idMal title{romaji english} coverImage{large extraLarge} bannerImage averageScore genres episodes seasonYear description(asHtml:false) nextAiringEpisode{airingAt timeUntilAiring episode}}}}`;
const Q_ANIME_RELATED = `query($id:Int!){Media(id:$id){recommendations(perPage:12,sort:RATING_DESC){nodes{mediaRecommendation{id idMal title{romaji english} coverImage{large extraLarge} bannerImage averageScore genres episodes seasonYear status description(asHtml:false) isAdult}}}}}`;
const Q_ANIME_POP = `query($page:Int){Page(page:$page,perPage:24){pageInfo{hasNextPage} media(type:ANIME,sort:POPULARITY_DESC,isAdult:false){id idMal title{romaji english} coverImage{large} bannerImage averageScore genres episodes seasonYear trailer{id site}}}}`;
const Q_ANIME_GENRE = `query($page:Int,$genre:String){Page(page:$page,perPage:24){pageInfo{hasNextPage} media(type:ANIME,genre:$genre,sort:POPULARITY_DESC,isAdult:false){id idMal title{romaji english} coverImage{large} bannerImage averageScore genres episodes seasonYear trailer{id site}}}}`;
const Q_ANIME_GENRE_ADULT = `query($page:Int,$genre:String){Page(page:$page,perPage:24){pageInfo{hasNextPage} media(type:ANIME,genre:$genre,sort:POPULARITY_DESC,isAdult:true){id idMal title{romaji english} coverImage{large} bannerImage averageScore genres episodes seasonYear trailer{id site}}}}`;
const Q_ANIME_SEARCH = `query($q:String){Page(page:1,perPage:30){media(type:ANIME,search:$q,sort:SEARCH_MATCH){id idMal title{romaji english} coverImage{large} bannerImage averageScore genres episodes seasonYear trailer{id site}}}}`;
const Q_ANIME_REL = `query($id:Int){Media(id:$id,type:ANIME){id idMal title{romaji english native} status episodes seasonYear format relations{edges{relationType node{id idMal type format status title{romaji english native} synonyms episodes seasonYear}}}}}`;
const Q_ANIME_RECS = `query($id:Int){Media(id:$id,type:ANIME){recommendations(perPage:14,sort:RATING_DESC){nodes{mediaRecommendation{id idMal title{romaji english} coverImage{large} bannerImage averageScore genres episodes seasonYear}}}}}`;
const Q_ANIME_INFO = `query($id:Int){Media(id:$id,type:ANIME){id idMal title{romaji english native} synonyms status episodes averageScore genres seasonYear description(asHtml:false) coverImage{large} bannerImage nextAiringEpisode{timeUntilAiring episode}}}`;

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
    embed: imdb ? `https://vidsrc.pm/embed/movie/${imdb}` : '',
    summary: m.description || ''
  };
}
async function fetchCinemetaCatalog(kind, genre, skip = 0) {
  // Full genre shelves for movies AND series. Layered for reliability — and every
  // layer is checked against the source's own per-title genre tags (the same data
  // the detail page shows: "★ 6.1 · Action · Thriller"), so a shelf never drifts
  // into unrelated titles:
  //   1. TVMaze (series): a pooled, genre-verified show list — TVMaze's genre
  //      data is curated and the shows always carry real TV metadata.
  //   2. Cinemeta ranked /top/genre — fast and cached; titles whose own genre
  //      field lists the requested genre are promoted, everything else demoted.
  //   3. Shallow /genre feed — only a fallback, strictly genre-verified.
  //   4. Wikidata SPARQL — free, deterministic genre-verified lists by IMDb id.
  const want = genre.toLowerCase().replace(/[\s-]+/g, ' ');
  const mapAll = metas => metas.map(m => {
    const it = mapCinemetaMovie(m);
    if (kind === 'series') {
      it._type = 'tv'; it.id = it.imdb;
      it._title = m.name || 'Series';
      it.embed = it.imdb ? `https://vidsrc.pm/embed/tv/${it.imdb}` : '';
    }
    return it;
  }).filter(m => m.imdb);
  const sameGenre = g => String(g).toLowerCase().replace(/[\s-]+/g, ' ') === want;
  return cachedCatalog('shelf:' + kind + ':' + genre + ':' + skip, async () => {
    let out = [];
    if (kind === 'series' && !skip) {
      try { out = await fetchTvmazeGenre(genre); } catch (_) {}
    }
    if (out.length < 6) {
      try {
        const suffix = skip ? '&skip=' + skip : '';
        const res = await fetch(`${CINEMETA}/catalog/${kind}/top/genre=${encodeURIComponent(genre)}${suffix}.json`);
        if (res.ok) out = mapAll((await res.json()).metas || []);
      } catch (_) { /* fall through */ }
    }
    // Genre-truth pass on the ranked feed: titles whose own genre field (the
    // data the detail page shows) lists the genre are promoted; when enough do,
    // they become the whole shelf.
    if (out.length >= 6) {
      const tags = out.filter(m => (m._genres || []).length);
      if (tags.length) {
        const matched = out.filter(m => (m._genres || []).some(sameGenre));
        if (matched.length >= 6) out = matched;
        else if (matched.length) out = matched.concat(out.filter(m => !matched.includes(m)));
      }
    }
    if (!skip && out.length < 6) {
      try {
        const res = await fetch(`${CINEMETA}/catalog/${kind}/genre/${encodeURIComponent(genre)}.json`);
        if (res.ok) {
          out = mapAll((await res.json()).metas || []).filter(m =>
            (m._genres || []).some(sameGenre));
        }
      } catch (_) { /* fall through */ }
    }
    if (!skip && out.length < 6) {
      try { out = await fetchWikiShelf(kind === 'series' ? 'series' : 'movie', genre); } catch (_) {}
    }
    if (!out.length) throw new Error('Shelf ' + kind + ':' + genre + ' unavailable');
    return out;
  });
}

// ---- TVMaze genre pool for series categories (curated genre data) ----
// TVMaze has no genre endpoint, so a set of /shows pages is fetched once per
// rotation and filtered per genre. Pages spread across the catalog keep good
// genre coverage; only the small FILTERED lists get cached.
function tvmazePoolPages() {
  const bucket = Math.floor(Date.now() / (6 * 3600 * 1000)); // rotate the pool every 6h
  const base = (bucket % 5) * 9;
  return [base, base + 44, base + 96];
}
async function fetchTvmazeGenre(genre) {
  const mark = tvmazePoolPages().join('-');
  const want = String(genre).replace(/[\s-]+/g, '').toLowerCase();
  return cachedCatalog('tvmazegen:' + want + ':' + mark, async () => {
    const lists = await Promise.all(tvmazePoolPages().map(p =>
      fetch(TVMAZE + '/shows?page=' + p).then(r => r.ok ? r.json() : []).catch(() => [])
    ));
    return lists.flat()
      .filter(s => (s.genres || []).some(g => String(g).replace(/[\s-]+/g, '').toLowerCase() === want))
      .slice(0, 42)
      .map(mapTvmaze);
  }).catch(() => []);
}

// ---- Wikidata SPARQL fallback (movies/series by exact genre item, imdb ids) ----
// Genre items were resolved once against Wikidata's search API and baked here, so
// the runtime never waits on a lookup search.
const WIKI_ITEM = { movie: 'Q11424', series: 'Q5398426' }; // film / television series
const WIKI_GENRE_QID = {
  'action': 'Q188473', 'adventure': 'Q319221', 'animation': 'Q202866', 'comedy': 'Q157443',
  'crime': 'Q959790', 'documentary': 'Q93204', 'drama': 'Q130232', 'fantasy': 'Q157394',
  'history': 'Q17013749', 'horror': 'Q200092', 'music': 'Q109733358', 'mystery': 'Q218768',
  'romance': 'Q1054574', 'science fiction': 'Q471839', 'thriller': 'Q2484376',
  'war': 'Q369747', 'western': 'Q172980'
};
async function fetchWikiShelf(kind, genre) {
  const qid = WIKI_GENRE_QID[genre.toLowerCase()];
  const item = WIKI_ITEM[kind];
  if (!qid || !item) return [];
  const sparql = `SELECT ?imdb ?title (MAX(?d) AS ?date) WHERE {
    ?f wdt:P31/wdt:P279* wd:${item} ; wdt:P136 wd:${qid} ; wdt:P345 ?imdb .
    OPTIONAL { ?f wdt:P577 ?d }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". ?f rdfs:label ?title . }
  } GROUP BY ?imdb ?title ORDER BY DESC(?date) LIMIT 80`;
  const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql),
    { headers: { Accept: 'application/sparql-results+json' } });
  if (!res.ok) throw new Error('Wikidata ' + res.status);
  const j = await res.json();
  const rows = (j.results && j.results.bindings) || [];
  const year = new Date().getFullYear();
  const seen = new Set();
  const out = [];
  for (const b of rows) {
    const imdb = b.imdb && b.imdb.value || '';
    if (!imdb || seen.has(imdb) || !/^tt\d+/.test(imdb)) continue;
    const yr = b.date && b.date.value ? Number(b.date.value.slice(0, 4)) : 0;
    if (yr > year) continue; // unreleased lists pollute the results
    seen.add(imdb);
    out.push({
      _type: kind === 'series' ? 'tv' : 'movie', id: imdb, imdb,
      _title: b.title && b.title.value || 'Untitled',
      _poster: `https://images.metahub.space/poster/medium/${imdb}/img`,
      _backdrop: `https://images.metahub.space/background/medium/${imdb}/img`,
      _sub: [yr || '', (genre === 'Adult' ? '18 Plus' : genre)].filter(Boolean).join(' · '),
      _year: yr, _genres: [genre], _src: 'Wikidata',
      embed: `https://vidsrc.pm/embed/${kind === 'series' ? 'tv' : 'movie'}/${imdb}`,
      summary: ''
    });
  }
  return out;
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
    _src: 'TVmaze', summary: stripHtml(s.summary), premiered: s.premiered, genres: Array.isArray(s.genres) ? s.genres : []
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
