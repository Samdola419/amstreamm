// ---- Clean URLs / router ----
// Every screen owns a real path so the address bar looks professional:  /
// /anime  /movies  /movies/<Genre>  /series[/Genre]  /genre/<Name>  /list  /continue
// /play/movie/<imdb>/<tmdb>/<slug>   /play/tv/<imdb>/<tvmaze>/<slug>   /play/anime/<ani>/<mal>/<slug>
// /t/<type>/<id>/<slug>  (title page)   Legacy ?t=&id= share links keep working.
'use strict';

function slugify(s) {
  const base = String(s || '').trim().replace(/['\u2019:!,."]+/g, '').replace(/\s+/g, ' ').slice(0, 64);
  if (!base) return 'watch';
  const kept = encodeURIComponent(base).replace(/%20/g, '-').replace(/%[0-9A-F]{2}/gi, '');
  return kept || encodeURIComponent(base).replace(/%20/g, '-') || 'watch';
}
function unslugify(u) {
  const d = decodeURIComponent(String(u || '').replace(/-/g, '%20') || '');
  return d.replace(/\b\w/g, c => c.toUpperCase());
}
function titleSlug(m) { return slugify(m && (m._title || m.title)); }

function routeFor(entry) {
  if (!entry) return '/';
  switch (entry.kind) {
    case 'home': return '/';
    case 'browse': {
      const m = entry.mode, g = entry.genre;
      if (m === 'movies') return g ? '/movies/' + encodeURIComponent(String(g)) : '/movies';
      if (m === 'series') return g ? '/series/' + encodeURIComponent(String(g)) : '/series';
      if (m === 'anime') return '/anime';
      if (m === 'category') return '/category';
      if (m === 'genre') return '/genre/' + encodeURIComponent(String(g || ''));
      if (m === 'mylist') return '/list';
      if (m === 'continue') return '/continue';
      if (m === 'manga') return '/manga';
      if (m === 'coming') return '/coming';
      return '/';
    }
    case 'mylist': return '/list';
    case 'continue': return '/continue';
    case 'detail': case 'reader': case 'comic': {
      const m = entry.media || {};
      const type = m._type || 'anime';
      const id = type === 'anime' ? (m.id || m.ani_id) : type === 'movie' ? m.imdb : (m.tvmaze || m.id);
      return '/t/' + type + '/' + encodeURIComponent(String(id || '')) + '/' + titleSlug(m);
    }
    case 'player': {
      if (entry.playerType === 'movie')
        return '/play/movie/' + encodeURIComponent(String(entry.imdb || '')) + '/' + (entry.tmdb || 0) + '/' + slugify(entry.title);
      if (entry.playerType === 'tv')
        return '/play/tv/' + encodeURIComponent(String(entry.imdb || '')) + '/' + (entry.tvmaze || 0) + '/' + slugify(entry.title);
      return '/play/anime/' + (entry.aniId || 0) + '/' + (entry.malId || 0) + '/' + slugify(entry.title);
    }
    default: return '/';
  }
}

// Deep links: resolve the item the same way shared links do, then open the right screen.
function sharedLinkItem(type, id) {
  if (type === 'anime') return anilist(Q_ANIME_INFO, { id: Number(id) }).then(d => d?.Media ? mapAnime(d.Media) : null);
  if (type === 'movie') return fetch(CINEMETA + '/meta/movie/' + encodeURIComponent(id) + '.json')
    .then(r => r.ok ? r.json() : null).then(j => { if (!j) return null; if (j.meta) return mapCinemetaMovie({ ...j.meta, imdb_id: id }); return null; });
  if (type === 'tv') return fetch(TVMAZE + '/shows/' + encodeURIComponent(id))
    .then(r => r.ok ? r.json() : null).then(j => j ? mapTvmaze(j) : null);
  if (type === 'manga') return mangaApi({ op: 'detail', id }).then(d => d?.item ? mapManga(d.item) : null);
  if (type === 'comic') return comicsApi({ op: 'detail', id }).then(d => d?.item ? mapComic(d.item) : null);
  return Promise.resolve(null);
}

async function routerBoot() {
  let seg;
  try { seg = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean); }
  catch (_) { return; }
  const q = new URLSearchParams(location.search);
  // Legacy shared-link form: /?t=anime|movie|tv&id=...
  if (!seg.length && q.get('t') && q.get('id')) {
    const item = await sharedLinkItem(q.get('t'), q.get('id'));
    if (item) openDetails(item);
    return;
  }
  try {
    if (seg[0] === 'play' && seg.length > 2) {
      if (seg[1] === 'movie' && seg[3]) {
        const imdb = decodeURIComponent(seg[2]), tmdb = Number(seg[3]) || 0;
        const item = await sharedLinkItem('movie', imdb);
        if (item) { openMovie(tmdb || item.tmdb || 0, imdb, item._title, true); return; }
      } else if (seg[1] === 'tv' && seg[4]) {
        const imdb = decodeURIComponent(seg[2]), tvmaze = Number(seg[3]) || 0;
        const item = await sharedLinkItem('tv', String(Math.max(1, tvmaze)));
        if (item) { openTv(imdb, tvmaze, item._title, true); return; }
      } else if (seg[1] === 'anime' && seg[4]) {
        const ani = Number(seg[2]), mal = Number(seg[3]) || 0;
        const item = await sharedLinkItem('anime', String(ani || 1));
        if (item) { openAnime(ani || item.id, mal || item.idMal, item._title, item.episodes || 0, true); return; }
      }
    } else if (seg[0] === 't' && seg.length > 2) {
      const item = await sharedLinkItem(seg[1], decodeURIComponent(seg[2]));
      if (item) { openDetails(item, true); return; }
    } else if (seg[0] === 'anime' || seg[0] === 'movies' || seg[0] === 'series') {
      if (seg.length > 1) { nav(seg[0], decodeURIComponent(seg.slice(1).join('/')), true); return; }
      nav(seg[0] === 'anime' ? 'anime' : seg[0], null, true); return;
    } else if (seg[0] === 'category') {
      nav('category', seg[1] ? decodeURIComponent(seg[1]) : null, true); return;
    } else if (seg[0] === 'genre' && seg.length > 1) {
      nav('genre', decodeURIComponent(seg.slice(1).join('/')), true); return;
    } else if (seg[0] === 'list') { openMyList(true); return; }
    else if (seg[0] === 'continue') { openContinue(true); return; }
    else if (seg[0] === 'coming') { openComing(true); return; }
    else if (seg[0] === 'manga') { nav('manga', null, true); return; }
  } catch (e) { console.warn('route could not be opened', e); }
  // unknown or failed: stay home (boot.js already renders the home page)
  try { history.replaceState({ app: 1, i: 0 }, '', '/'); } catch (_) {}
}
