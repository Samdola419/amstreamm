// ---- Sections: switch any of these to true to bring that section back (nav, home rows, search, lists). ----
const SECTIONS = { anime: true, movies: true, series: true, manga: false };
const TYPE_ENABLED = { anime: SECTIONS.anime, movie: SECTIONS.movies, tv: SECTIONS.series, manga: SECTIONS.manga, comic: SECTIONS.manga };
const NAV_ON = { home: true, anime: SECTIONS.anime, movies: SECTIONS.movies, series: SECTIONS.series, manga: SECTIONS.manga, mylist: true, continue: true };
const ENABLED_TYPE_COUNT = Object.values(SECTIONS).filter(Boolean).length + (SECTIONS.manga ? 1 : 0);
const ANILIST = 'https://graphql.anilist.co';
const TVMAZE = 'https://api.tvmaze.com';
const CINEMETA = 'https://v3-cinemeta.strem.io';
const $ = id => document.getElementById(id);

// Preferred servers are intentionally first. The player uses this order for its
// initial load and for timeout-based retries; viewers can still choose any server.
const MOVIE_SERVERS = [
  { name: 'VidSpark', url: m => `https://vidspark.to/movie/${m.imdb || m.tmdb}` },
  { name: 'VidSrc', url: m => m.embed || `https://vid-src.top/embed/movie/${m.imdb || m.tmdb}` },
  { name: 'VidSrc Link', url: m => `https://vidsrc.link/embed/movie/${m.imdb || m.tmdb}` },
  { name: 'VidSrc PM', url: m => `https://vidsrc.pm/embed/movie/${m.imdb || m.tmdb}` },
  { name: 'Videasy', url: m => `https://player.videasy.to/movie/${m.imdb || m.tmdb}` },
];
const TV_SERVERS = [
  { name: 'VidSpark', url: (id,s,e) => `https://vidspark.to/tv/${id}/${s}/${e}` },
  { name: 'VidSrc', url: (id,s,e) => `https://vid-src.top/embed/tv/${id}/${s}/${e}` },
  { name: 'VidSrc Link', url: (id,s,e) => `https://vidsrc.link/embed/tv/${id}/${s}/${e}` },
  { name: 'VidSrc PM', url: (id,s,e) => `https://vidsrc.pm/embed/tv/${id}/${s}/${e}` },
  { name: 'Videasy', url: (id,s,e) => `https://player.videasy.to/tv/${id}/${s}/${e}` },
];

const ANIME_SERVERS = [
  { name: 'MegaPlay', url: (m, ep, lang) => {
      const q = new URLSearchParams({ ep: String(ep), lang: lang || 'sub' });
      if (m.mal_id) q.set('mal', String(m.mal_id));
      if (m.ani_id) q.set('ani', String(m.ani_id));
      return `/megaplay.html?${q.toString()}`;
    } },
  { name: 'VidHawk', url: (m, ep, lang) => m.ani_id ? `https://vidhawk.buzz/embed/ani/${m.ani_id}/${ep}/${lang}` : `https://vidhawk.buzz/embed/mal/${m.mal_id}/${ep}/${lang}` },
  { name: 'VidLink', url: (m, ep, lang) => `https://vidlink.pro/anime/${m.mal_id || m.ani_id}/${ep}/${lang}` },
  { name: 'VidSrc', url: (m, ep) => m.tmdb ? `https://vid-src.top/embed/tv/${m.tmdb}/1/${ep}` : `https://vidsrc.sh/embed/anime/${m.mal_id || m.ani_id}/1/${ep}` },
  { name: 'VidSrc PM', url: (m, ep) => m.imdb ? `https://vidsrc.pm/embed/tv/${m.imdb}/1/${ep}` : '' },
  { name: '2Embed', url: (m, ep) => m.imdb ? `https://www.2embed.cc/embedtv/${m.imdb}&s=1&e=${ep}` : '' },
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
  const key = 'anilist:' + query + ':' + JSON.stringify(variables);
  return cachedCatalog(key, async () => {
    const res = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) throw new Error('AniList ' + res.status);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message || 'AniList error');
    return json.data;
  });
}

const Q_ANIME_TREND = `query($page:Int){Page(page:$page,perPage:24){pageInfo{hasNextPage} media(type:ANIME,sort:TRENDING_DESC,isAdult:false){id idMal title{romaji english} coverImage{large extraLarge} bannerImage trailer{ id site } averageScore genres episodes seasonYear description(asHtml:false)}}}`;
const Q_ANIME_POP = `query($page:Int){Page(page:$page,perPage:24){pageInfo{hasNextPage} media(type:ANIME,sort:POPULARITY_DESC,isAdult:false){id idMal title{romaji english} coverImage{large} bannerImage trailer{ id site } averageScore genres episodes seasonYear}}}`;
const Q_ANIME_GENRE = `query($page:Int,$genre:String){Page(page:$page,perPage:24){pageInfo{hasNextPage} media(type:ANIME,genre:$genre,sort:POPULARITY_DESC,isAdult:false){id idMal title{romaji english} coverImage{large} bannerImage trailer{ id site } averageScore genres episodes seasonYear}}}`;
const Q_ANIME_GENRE_ADULT = `query($page:Int,$genre:String){Page(page:$page,perPage:24){pageInfo{hasNextPage} media(type:ANIME,genre:$genre,sort:POPULARITY_DESC,isAdult:true){id idMal title{romaji english} coverImage{large} bannerImage trailer{ id site } averageScore genres episodes seasonYear}}}`;
const Q_ANIME_SEARCH = `query($q:String){Page(page:1,perPage:30){media(type:ANIME,search:$q,sort:SEARCH_MATCH){id idMal title{romaji english} coverImage{large} bannerImage trailer{ id site } averageScore genres episodes seasonYear}}}`;
const Q_ANIME_REL = `query($id:Int){Media(id:$id,type:ANIME){id idMal title{romaji english} episodes seasonYear format relations{edges{relationType node{id idMal type format title{romaji english} episodes seasonYear}}}}}`;
const Q_ANIME_RECS = `query($id:Int){Media(id:$id,type:ANIME){recommendations(perPage:14,sort:RATING_DESC){nodes{mediaRecommendation{id idMal title{romaji english} coverImage{large} bannerImage trailer{ id site } averageScore genres episodes seasonYear}}}}}`;
const Q_ANIME_INFO = `query($id:Int){Media(id:$id,type:ANIME){id idMal title{romaji english} episodes averageScore genres seasonYear description(asHtml:false) coverImage{large} bannerImage trailer{ id site }}}`;
