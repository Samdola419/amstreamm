// Saved list and recent titles are local to this browser; no account or server is required.
function safeReadStore(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return Array.isArray(v) ? v : fallback; }
  catch (_) { return fallback; }
}
function safeWriteStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private browsing/storage disabled */ }
}
function serialMedia(item) {
  const m = item || {};
  return {
    _type:m._type || m.type || 'anime', id:m.id || m.ani_id || m.tmdb || m.imdb || '',
    idMal:m.idMal || m.mal_id || m.mal || 0, ani_id:m.ani_id || m.id || '', mal_id:m.mal_id || m.idMal || m.mal || 0,
    imdb:m.imdb || '', tmdb:m.tmdb || '', tvmaze:m.tvmaze || '',
    _title:m._title || m.title || 'Untitled', title:m._title || m.title || 'Untitled',
    _poster:m._poster || m.coverImage?.large || '', _posterFallback:m._posterFallback || m.image?.medium || '', _backdrop:m._backdrop || m.bannerImage || m._poster || '',
    bannerImage:m.bannerImage || m._backdrop || '', summary:m.summary || stripHtml(m.description) || '', description:m.description || m.summary || '',
    _sub:m._sub || '', episodes:m.episodes || 0, seasonYear:m.seasonYear || '', averageScore:m.averageScore || null,
    genres:(Array.isArray(m.genres) ? m.genres : Array.isArray(m._genres) ? m._genres : []).slice(0,8), trailer:m.trailer || null, trailers:Array.isArray(m.trailers) ? m.trailers.slice(0,4) : [], _src:m._src || ''
  };
}
function mediaKey(item) {
  const m = item || {};
  return `${m._type || m.type || 'anime'}:${m.id || m.imdb || m.tmdb || m.tvmaze || m._title || m.title || ''}`.toLowerCase();
}
function getSavedList() { return safeReadStore('animestream.mylist.v1', []); }
function isSaved(item) { const key=mediaKey(item); return getSavedList().some(m=>mediaKey(m)===key); }
function updateSavedCount() { const el=$('savedCount'); if(el) el.textContent=String(getSavedList().length); }
function toggleSaved(item) {
  const normalized=serialMedia(item), list=getSavedList(), key=mediaKey(normalized);
  const index=list.findIndex(m=>mediaKey(m)===key);
  if(index>=0) list.splice(index,1); else list.unshift({ ...mergeRich(normalized,list[index]), _savedAt:Date.now() });
  safeWriteStore('animestream.mylist.v1',list.slice(0,300));
  updateSavedCount();
  const button=$('detailSave');
  if(activeDetail && mediaKey(activeDetail)===key && button) {
    const saved=index<0; button.classList.toggle('saved',saved); button.innerHTML=saved?'<i class="ri-check-line" aria-hidden="true"></i> In My List':'<i class="ri-bookmark-line" aria-hidden="true"></i> My List';
  }
  return index<0;
}
// Older saved Continue/My List entries can be missing artwork; backfill posters in the background, then repaint.
const artworkBackfill = new Set();
function backfillStoredArtwork(storeKey) {
  const list = safeReadStore(storeKey, []);
  list.forEach(item => {
    if (posterCandidates(item)[0]) return; // already has artwork
    const type = item._type || item.type;
    const sig = storeKey + ':' + mediaKey(item);
    if (artworkBackfill.has(sig)) return;
    let lookup = null;
    if (type === 'anime' && Number(item.id) > 0) lookup = anilist(Q_ANIME_INFO, { id: Number(item.id) }).then(d => d?.Media ? mapAnime(d.Media) : null);
    else if (type === 'tv' && /^\d+$/.test(String(item.tvmaze || ''))) lookup = fetch(`${TVMAZE}/shows/${item.tvmaze}`).then(r => r.ok ? r.json() : null).catch(() => null).then(s => s ? mapTvmaze(s) : null);
    else if (type === 'movie' && item.imdb) lookup = Promise.resolve(null); // metahub already supplies a poster from the imdb id
    if (!lookup) return;
    artworkBackfill.add(sig);
    return lookup.then(rich => { if (rich && patchStoredItem(storeKey, item, rich)) repaintOpenCollection(); })
      .catch(() => {})
      .finally(() => artworkBackfill.delete(sig));
  });
}
function patchStoredItem(storeKey, item, rich) {
  const list = safeReadStore(storeKey, []), key = mediaKey(item);
  const idx = list.findIndex(x => mediaKey(x) === key);
  if (idx < 0) return false;
  list[idx] = mergeRich(serialMedia(rich), list[idx]);
  safeWriteStore(storeKey, list);
  return true;
}
function repaintOpenCollection() {
  if (currentScreenId === 'continueView') { const list = allMedia(getContinueList()); setCollectionArt(list); $('continueGrid').innerHTML = list.length ? list.map(cardHTML).join('') : $('continueGrid').innerHTML; }
  else if (currentScreenId === 'myListView') renderMyList();
}
// Per-title watch position: which episode (and season / language) was last opened, so coming back resumes there.
const PROGRESS_KEY = 'animestream.progress.v1';
function readProgress() { try { const v = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } }
function getProgress(type, id) { return id ? readProgress()[type + ':' + id] || null : null; }
function saveProgress(patch) {
  if (!current || !patch) return;
  try {
    const all = readProgress();
    const keys = new Set();
    if (current.type === 'anime') { keys.add('anime:' + current.openedId); keys.add('anime:' + current.ani_id); }
    else if (current.type === 'tv') keys.add('tv:' + (current.tvmaze || current.imdb));
    keys.forEach(k => { if (!k.endsWith(':') && !k.endsWith(':undefined')) all[k] = { ...(all[k] || {}), ...patch, t: Date.now() }; });
    const entries = Object.entries(all).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, 200);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (_) { /* storage disabled */ }
}
function progressLabel(item) {
  const type = item?._type || item?.type;
  if (type !== 'anime' && type !== 'tv') return '';
  const pr = getProgress(type, type === 'tv' ? (item.tvmaze || item.id) : item.id);
  if (!pr || pr.e == null) return '';
  return type === 'tv' ? `S${pr.s || 1} E${pr.e + 1}` : `Episode ${pr.e + 1}`;
}
function getContinueList() { return safeReadStore('animestream.continue.v1', []); }
// Device-local continue list includes every supported media type.
const allMedia = list => (list || []); // Keep every supported title type in the local library.
// Fields that make a stored card look complete: artwork, description, badges.
const RICH_FIELDS = ['_poster','_posterFallback','_backdrop','bannerImage','summary','description','_sub','seasonYear','averageScore','episodes','genres','trailer','trailers'];
function mergeRich(fresh, stored) {
  const out = { ...stored, ...fresh };
  RICH_FIELDS.forEach(k => {
    const v = fresh[k], was = stored?.[k];
    const empty = Array.isArray(v) ? !v.length : v === '' || v == null || v === 0;
    if (empty && was != null) { if (Array.isArray(was)) out[k] = [...was]; else out[k] = was; }
  });
  if (!out.episodes || out.episodes < 0) out.episodes = 0;
  return out;
}
function rememberContinue(item) {
  if(!item) return;
  const m=serialMedia(item), key=mediaKey(m);
  if (!(m.id || m.imdb || m.tmdb || m.tvmaze)) return; // no usable catalogue id
  const list=getContinueList();
  const stored=list.find(x=>mediaKey(x)===key);
  const filtered=list.filter(x=>mediaKey(x)!==key);
  filtered.unshift({ ...mergeRich(m,stored), _updatedAt:Date.now() });
  safeWriteStore('animestream.continue.v1',filtered.slice(0,30));
}
function playItem(item) {
  if(!item) return;
  const type=item._type || item.type;
  if(type==='anime') openAnime(item.id || item.ani_id || item.aniId, item.idMal || item.mal_id || item.malId || 0, item._title || item.title, item.episodes || 12);
  else if(type==='movie') openMovie(item.tmdb || item.id, item.imdb || '', item._title || item.title);
  else if(type==='manga') readManga(item);
  else if(type==='comic') readComic(item);
  else openTv(item.imdb || '', String(item.tvmaze || item.id || ''), item._title || item.title);
}
function openDetails(item, silent=false) {
  if(!item) return;
  activeDetail=serialMedia(item);
  if(!silent && !applyingHistory) pushHist({kind:'detail',media:activeDetail});
  closeSearch(); toggleProfileMenu(true); setNav('');
  const m=activeDetail, title=m._title || 'Untitled';
  const poster=posterSrc(m) || m._poster || '';
  const detailCandidates = uniqueArtworkUrls([m.bannerImage, m._backdrop, m.imdb && String(m.imdb).startsWith('tt') ? `https://images.metahub.space/background/medium/${m.imdb}/img` : '', ...posterCandidates(m)]);
  $('detailHero').style.setProperty('--detail-image', 'none');
  setFirstAvailableArtwork($('detailHero'), detailCandidates, image => $('detailHero').style.setProperty('--detail-image', image ? `url("${String(image).replace(/"/g,'%22')}")` : 'none'));
  $('detailKicker').textContent=m._type==='anime'?'ANIME DISCOVERY':m._type==='tv'?'SERIES SPOTLIGHT':m._type==='manga'?'MANGA SPOTLIGHT':m._type==='comic'?'COMIC SPOTLIGHT':'MOVIE SPOTLIGHT';
  $('detailTitle').textContent=title;
  const year=m.seasonYear || (m.premiered||'').slice(0,4) || '';
  const score=m.averageScore ? (Number(m.averageScore)>10?(Number(m.averageScore)/10).toFixed(1):Number(m.averageScore).toFixed(1)) : (String(m._sub??'').match(/★\s*([\d.]+)/)?.[1]||'');
  const metas=[];
  if(score) metas.push(`<span class="score">★ ${escHtml(score)}</span>`);
  if(year) metas.push(`<span>${escHtml(year)}</span>`);
  metas.push(`<span>${m._type==='anime'?'Anime':m._type==='tv'?'Series':m._type==='manga'?'Manga':m._type==='comic'?'Comic':'Movie'}</span>`);
  (m.genres||[]).slice(0,3).forEach(g=>metas.push(`<span>${escHtml(g)}</span>`));
  $('detailMeta').innerHTML=metas.join('');
  let desc=stripHtml(m.description || m.summary || 'A new discovery is waiting. Explore the title, then choose Play to open the available player.');
  $('detailDescription').textContent=desc || 'A new discovery is waiting. Explore the title, then choose Play to open the available player.';
  const detailPosters = posterCandidates(m);
  $('detailPosterWrap').innerHTML=poster?`<img src="${escAttr(poster)}" data-poster-fallback="${escAttr(JSON.stringify(detailPosters.slice(1)))}" alt="${escAttr(title)} poster" loading="eager" onerror="handlePosterError(this)">`:'';
  $('detailFacts').innerHTML=[m._src?`<span class="detail-fact"><b>Catalog</b> · ${escHtml(m._src)}</span>`:'',m._sub?`<span class="detail-fact">${escHtml(m._sub)}</span>`:''].filter(Boolean).join('');
  const detailTrailerId = trailerYoutubeId(m);
  $('detailTrailer').innerHTML = detailTrailerMarkup(title, detailTrailerId);
  if (!detailTrailerId && ['movie','tv'].includes(m._type)) {
    const detailKey = mediaKey(m);
    resolveTrailerId(m).then(found => {
      if (!found || !activeDetail || mediaKey(activeDetail) !== detailKey) return;
      $('detailTrailer').innerHTML = detailTrailerMarkup(title, found);
      const stored = getSavedList();
      const index = stored.findIndex(item => mediaKey(item) === detailKey);
      if (index >= 0) { stored[index] = mergeRich(m, stored[index]); safeWriteStore('animestream.mylist.v1', stored); }
    }).catch(() => {});
  }
  const saved=isSaved(m); $('detailSave').classList.toggle('saved',saved); $('detailSave').innerHTML=saved?'<i class="ri-check-line" aria-hidden="true"></i> In My List':'<i class="ri-bookmark-line" aria-hidden="true"></i> My List';
  $('detailSave').disabled=false;
  $('detailPlay').innerHTML = (m._type==='manga'||m._type==='comic') ? '<i class="ri-book-open-line" aria-hidden="true"></i> Read' : '<i class="ri-play-fill" aria-hidden="true"></i> Play';
  const resumeLbl = progressLabel(m);
  if (resumeLbl) $('detailPlay').innerHTML = `<i class="ri-play-fill" aria-hidden="true"></i> Resume ${escHtml(resumeLbl)}`;
  $('detailPlay').onclick=()=>playItem(m);
  renderMangaChapters(m);
  $('detailSave').onclick=()=>toggleSaved(m);
  $('detailShare').onclick=()=>shareTitle(m);
  const currentCollection=Array.from(mediaRegistry.values());
  const related=currentCollection.filter(x=>mediaKey(x)!==mediaKey(m) && (x._title||x.title)!==title);
  // Reuse already-loaded catalog items for instant recommendations, including anime, films, and series.
  const recs=related.slice(0,10);
  $('detailRelated').innerHTML=recs.length?rowHTML('You may <em>also like</em>',recs,null,'detailRelatedRow'):'';
  if(m._type==='anime' && m.id){
    const key=mediaKey(m);
    anilist(Q_ANIME_INFO,{id:m.id}).then(d=>{
      if(!activeDetail || mediaKey(activeDetail)!==key) return;
      const n=d?.Media?.episodes;
      $('detailMeta').insertAdjacentHTML('beforeend',`<span>${n?n+' episodes':'Ongoing'}</span>`);
      $('detailFacts').insertAdjacentHTML('afterbegin',`<span class="detail-fact"><b>Episodes</b> · ${n||'Ongoing'}</span>`);
    }).catch(()=>{});
  }
  showPage('detailView');
}
// ---- Sharing: poster image + a link that reopens this exact title ----
function shareLink(m) {
  const type = routeType(m._type || m.type || 'anime');
  const id = routeIdentifier(m, type);
  return id ? location.origin + `/title/${type}/${encodeURIComponent(id)}` : location.origin + '/';
}
async function shareTitle(m) {
  const btn = $('detailShare'), title = m._title || 'this title', link = shareLink(m);
  const text = `Watch ${title} on AnimeStream`;
  const flash = () => { btn.innerHTML = '<i class="ri-check-line" aria-hidden="true"></i>'; setTimeout(() => btn.innerHTML = '<i class="ri-share-line" aria-hidden="true"></i>', 1400); };
  try {
    if (navigator.share) { await navigator.share({ title, text, url: link }); return; }
    await navigator.clipboard.writeText(`${text}\n${link}`); flash();
  } catch (e) {
    if (e?.name === 'AbortError') return;
    try { await navigator.clipboard.writeText(`${text}\n${link}`); flash(); } catch (_) {}
  }
}
// Opens ?t=anime|movie|tv&id=... links straight onto that title's page.
async function openSharedLink() {
  const q = new URLSearchParams(location.search), type = q.get('t'), id = q.get('id');
  if (!type || !id) return;
  try {
    let item = null;
    if (type === 'anime') { const d = await anilist(Q_ANIME_INFO, { id: Number(id) }); if (d?.Media) item = mapAnime(d.Media); }
    else if (type === 'movie') { const r = await fetch(`${CINEMETA}/meta/movie/${encodeURIComponent(id)}.json`); if (r.ok) { const j = await r.json(); if (j.meta) item = mapCinemetaMovie({ ...j.meta, imdb_id: id }); } }
    else if (type === 'tv') { const r = await fetch(`${TVMAZE}/shows/${encodeURIComponent(id)}`); if (r.ok) item = mapTvmaze(await r.json()); }
    else if (type === 'manga') { const d = await mangaApi({ op: 'detail', id }); if (d?.item) item = mapManga(d.item); }
    else if (type === 'comic') { const d = await comicsApi({ op: 'detail', id }); if (d?.item) item = mapComic(d.item); }
    if (item) openDetails(item);
  } catch (e) { console.warn('Shared link could not be opened', e); }
}

// ---- Manga (MangaDex through /api/manga) and the chapter reader ----
const MANGA_GENRES = ['Action','Adventure','Comedy','Drama','Fantasy','Horror','Mystery','Romance','Sci-Fi','Slice of Life','Sports','Supernatural'];
const COMIC_GENRES = ['Superhero','Horror','Science Fiction','Western','Crime','Humor','Romance','War','Adventure','Fantasy'];
const READ_SORTS = {
  manga: [['trending','Trending'],['popular','Popular'],['latest','Latest'],['rating','Top rated'],['new','New']],
  comic: [['trending','Trending'],['popular','Popular'],['latest','Recently added'],['classic','Classic']]
};
// [label, sort, genre]: each one becomes a shelf on the landing page, same as the other sections.
const READ_SHELVES = {
  manga: [['Trending','trending',''],['Popular','popular',''],['Latest','latest',''],['Top rated','rating',''],['Action','popular','Action'],['Romance','popular','Romance'],['Fantasy','popular','Fantasy'],['Comedy','popular','Comedy']],
  comic: [['Trending','trending',''],['Popular','popular',''],['Recently added','latest',''],['Superhero','popular','Superhero'],['Horror','popular','Horror'],['Sci-Fi','popular','Science Fiction'],['Western','popular','Western'],['Crime','popular','Crime'],['Humor','popular','Humor']]
};
const READ_NAME = { manga: 'Manga', comic: 'Comics' };
let readKind = 'manga', readScope = 'both', readSort = 'popular', readGenre = '', readQuery = '', readMode = 'landing';
let readGrid = [], readOffset = 0, readTotal = 0, readLoading = false, readReq = 0, readSearchTimer = null, mangaTags = null;
let reader = null, readerToken = 0;
const mangaChapters = new Map();
const MANGA_PROGRESS = 'animestream.mangaprogress.v1', MANGA_SAVER = 'animestream.manga.saver';

async function readApi(route, params) {
  const qs = new URLSearchParams(params).toString();
  return cachedCatalog(route + ':v2:' + qs, async () => {
    const res = await fetch(`/api/${route}?` + qs);
    if (!res.ok) throw new Error(route + ' API ' + res.status);
    return res.json();
  }, 10 * 60 * 1000);
}
const mangaApi = p => readApi('manga', p);
const comicsApi = p => readApi('comics', p);
function mapManga(n) {
  const tags = n.tags || [];
  return {
    _type: 'manga', id: n.id, _title: n.title || 'Untitled',
    _poster: n.cover || '', _posterFallback: n.cover256 || '', _backdrop: n.cover || '',
    summary: n.description || '', description: n.description || '', seasonYear: n.year || '', genres: tags.slice(0, 6),
    _sub: [n.year, n.status ? n.status.charAt(0).toUpperCase() + n.status.slice(1) : '', tags.slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    _src: ''
  };
}
function mapComic(n) {
  return {
    _type: 'comic', id: n.id, _title: n.title || 'Untitled',
    _poster: n.cover || '', _posterFallback: n.cover || '', _backdrop: n.cover || '',
    summary: n.description || '', description: n.description || '', seasonYear: n.year || '', genres: (n.tags || []).slice(0, 6),
    _sub: [n.year, (n.authors || [])[0]].filter(Boolean).join(' · '),
    _src: ''
  };
}
async function fetchManga(opts = {}) {
  const p = { op: 'list', sort: opts.sort || 'popular', offset: String(opts.offset || 0) };
  if (opts.genreId) p.genre = opts.genreId;
  if (opts.q) p.q = opts.q;
  const d = await mangaApi(p);
  const items = (d.items || []).map(mapManga);
  items._total = d.total || 0;
  return items;
}
async function fetchComics(opts = {}) {
  const p = { op: 'list', sort: opts.sort || 'popular', offset: String(opts.offset || 0) };
  if (opts.genre) p.genre = opts.genre;
  if (opts.q) p.q = opts.q;
  const d = await comicsApi(p);
  const items = (d.items || []).map(mapComic);
  items._total = d.total || 0;
  return items;
}
async function loadMangaTags() {
  if (mangaTags) return mangaTags;
  const d = await mangaApi({ op: 'tags' });
  mangaTags = new Map((d.tags || []).map(t => [t.name.toLowerCase(), t.id]));
  return mangaTags;
}
async function fetchRead(kind, opts = {}) {
  if (kind === 'comic') return fetchComics(opts);
  let genreId;
  if (opts.genre) genreId = (await loadMangaTags()).get(String(opts.genre).toLowerCase());
  return fetchManga({ sort: opts.sort, offset: opts.offset, genreId, q: opts.q });
}

// ---- the Manga & Comics page: landing shelves, "view all" grids, and search ----
function parseReadSpec(spec) {
  if (!spec) return { kind: 'manga', sort: '', genre: '' };
  const [kind, sort, genre] = String(spec).split('|');
  return { kind: kind === 'comic' ? 'comic' : 'manga', sort: sort || '', genre: genre || '' };
}
function openManga(spec) {
  const s = parseReadSpec(spec);
  readKind = s.kind;
  setNav('manga'); showPage('mangaView');
  renderReadScope();
  if (s.sort || s.genre) { readMode = 'grid'; readSort = s.sort || 'popular'; readGenre = s.genre || ''; showReadGrid(); }
  else showReadLanding();
}
function renderReadTabs() {
  $('readTabs').innerHTML = ['manga', 'comic'].map(k => `<button class="chip ${k === readKind ? 'active' : ''}" onclick="setReadKind('${k}')">${READ_NAME[k]}</button>`).join('');
}
function renderReadScope() {
  $('readScope').innerHTML = [['both', 'Both'], ['manga', 'Manga'], ['comic', 'Comics']].map(([k, l]) => `<button type="button" class="up-tab ${k === readScope ? 'active' : ''}" onclick="setReadScope('${k}')">${l}</button>`).join('');
}
function setReadKind(k) { readKind = k; showReadLanding(); }
function setReadScope(s) { readScope = s; renderReadScope(); if (readMode === 'search') loadReadGrid(true); }
function readHeroArt(items) {
  const covers = (items || []).filter(Boolean).slice(0, 8).flatMap(i => [i._poster, i._posterFallback]);
  setFirstAvailableArtwork($('mangaHero'), uniqueArtworkUrls(covers), url => $('mangaHero').style.setProperty('--browse-image', url ? `url("${String(url).replace(/"/g, '%22')}")` : 'none'));
}
function showReadLanding() {
  readMode = 'landing'; readQuery = ''; $('readSearchInput').value = '';
  const req = ++readReq;
  $('readTabsWrap').classList.remove('hidden'); $('readGridBars').classList.add('hidden');
  $('mangaGrid').classList.add('hidden'); $('mangaMore').classList.add('hidden'); $('readRows').classList.remove('hidden');
  $('mangaCount').textContent = '';
  renderReadTabs();
  loadReadLanding(readKind, req);
}
async function loadReadLanding(kind, req) {
  const shelves = READ_SHELVES[kind], results = new Array(shelves.length).fill(null), box = $('readRows');
  box.innerHTML = '<div class="state">Curating your shelves…</div>';
  const paint = () => {
    if (req !== readReq) return;
    let html = '';
    shelves.forEach(([label, sort, genre], i) => {
      if (results[i]?.length) html += rowHTML(`${label} <em>${READ_NAME[kind]}</em>`, results[i].slice(0, 24), 'manga', `read_${kind}_${i}`, `${kind}|${sort}|${genre}`);
    });
    if (html) box.innerHTML = html;
  };
  let next = 0;
  const worker = async () => {
    while (next < shelves.length) {
      const i = next++, [, sort, genre] = shelves[i];
      try { results[i] = withPoster(await fetchRead(kind, { sort, genre })); } catch (_) { results[i] = []; }
      paint();
    }
  };
  await Promise.all([worker(), worker(), worker()]); // a few at a time keeps MangaDex's rate limit happy
  if (req !== readReq) return;
  if (!results.some(r => r?.length)) {
    const local = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    box.innerHTML = local
      ? '<div class="state error">Manga and comics load through the site\'s /api routes, which are not running here. Start the project with <b>vercel dev</b> (or deploy it) instead of opening index.html directly.</div>'
      : '<div class="state error">Could not load these shelves right now. Please try again in a moment.</div>';
  }
  else readHeroArt(results.flat());
}
function showReadGrid() {
  const req = ++readReq;
  $('readTabsWrap').classList.remove('hidden'); $('readRows').classList.add('hidden');
  $('readGridBars').classList.remove('hidden'); $('mangaGrid').classList.remove('hidden');
  renderReadTabs(); renderReadBars();
  loadReadGrid(true);
}
function renderReadBars() {
  const genres = readKind === 'comic' ? COMIC_GENRES : MANGA_GENRES;
  $('mangaSortBar').innerHTML = '<button class="chip" onclick="showReadLanding()">‹ All shelves</button>' +
    READ_SORTS[readKind].map(([k, l]) => `<button class="chip ${k === readSort ? 'active' : ''}" onclick="setReadSort('${k}')">${l}</button>`).join('');
  $('mangaGenreBar').innerHTML = ['All', ...genres].map(g => {
    const on = (g === 'All' && !readGenre) || g === readGenre;
    return `<button class="chip ${on ? 'active' : ''}" onclick="setReadGenre('${g === 'All' ? '' : g}')">${g}</button>`;
  }).join('');
}
function setReadSort(k) { readSort = k; renderReadBars(); loadReadGrid(true); }
function setReadGenre(g) { readGenre = g; renderReadBars(); loadReadGrid(true); }
function onReadSearch() {
  clearTimeout(readSearchTimer);
  const q = $('readSearchInput').value.trim();
  readSearchTimer = setTimeout(() => {
    if (q.length < 2) { if (readMode === 'search') showReadLanding(); return; }
    readQuery = q; readMode = 'search';
    $('readTabsWrap').classList.add('hidden'); $('readRows').classList.add('hidden'); $('readGridBars').classList.add('hidden'); $('mangaGrid').classList.remove('hidden');
    loadReadGrid(true);
  }, 320);
}
$('readSearchInput').addEventListener('input', onReadSearch);
async function loadReadGrid(reset) {
  if (readLoading && !reset) return;
  const req = reset ? ++readReq : readReq;
  readLoading = true;
  if (reset) { readOffset = 0; readGrid = []; readTotal = 0; $('mangaGrid').innerHTML = '<div class="state">Loading…</div>'; $('mangaMore').classList.add('hidden'); }
  try {
    let batch = [], more = false;
    if (readMode === 'search') {
      const kinds = readScope === 'both' ? ['manga', 'comic'] : [readScope];
      const lists = await Promise.all(kinds.map(k => fetchRead(k, { q: readQuery, offset: readOffset }).catch(() => [])));
      for (let i = 0; i < 24; i++) lists.forEach(l => { if (l[i]) batch.push(l[i]); }); // alternate so both show up
      readTotal = (reset ? 0 : readTotal) + lists.reduce((n, l) => n + (l._total || 0), 0);
      more = lists.some(l => l.length >= 24);
    } else {
      const raw = await fetchRead(readKind, { sort: readSort, genre: readGenre, offset: readOffset });
      readTotal = raw._total || 0;
      batch = withPoster(raw);
      more = raw.length > 0 && readOffset + 24 < Math.min(readTotal, 9000);
    }
    if (req !== readReq) return;
    readOffset += 24;
    const seen = new Set();
    readGrid = (reset ? batch : readGrid.concat(batch)).filter(i => { const k = i._type + ':' + i.id; return !seen.has(k) && seen.add(k); });
    $('mangaGrid').innerHTML = readGrid.length ? readGrid.map(cardHTML).join('') : `<div class="state">${readMode === 'search' ? `No matches for “${escHtml(readQuery)}”. Try another spelling or switch the search to Both.` : 'Nothing here yet.'}</div>`;
    $('mangaCount').textContent = readMode === 'search' ? `${readGrid.length}${more ? '+' : ''} results for “${readQuery}”` : (readTotal ? `${readTotal.toLocaleString()} titles` : '');
    $('mangaMore').classList.toggle('hidden', !more);
    if (reset && readMode === 'grid') readHeroArt(readGrid);
  } catch (e) {
    if (req === readReq) $('mangaGrid').innerHTML = '<div class="state error">Could not load this right now. Please try again in a moment.</div>';
  } finally {
    if (req === readReq) readLoading = false;
  }
}

function getMangaProgress(id) { try { return JSON.parse(localStorage.getItem(MANGA_PROGRESS) || '{}')[id] || null; } catch (_) { return null; } }
function setMangaProgress(id, ch) { try { const o = JSON.parse(localStorage.getItem(MANGA_PROGRESS) || '{}'); o[id] = ch; localStorage.setItem(MANGA_PROGRESS, JSON.stringify(o)); } catch (_) {} }
function getMangaChapters(id) {
  if (!mangaChapters.has(id)) mangaChapters.set(id, mangaApi({ op: 'chapters', id }).then(d => d.chapters || []).catch(e => { mangaChapters.delete(id); throw e; }));
  return mangaChapters.get(id);
}
const chapterLabel = c => (c.chapter != null && c.chapter !== '') ? `Ch. ${c.chapter}` : 'Oneshot';
async function renderMangaChapters(m) {
  const box = $('detailChapters');
  if (!box) return;
  if (m._type !== 'manga') { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="state">Loading chapters…</div>';
  try {
    const list = await getMangaChapters(m.id);
    if (!activeDetail || activeDetail.id !== m.id) return;
    if (!list.length) { box.innerHTML = '<div class="state">No English chapters are available for this title yet.</div>'; return; }
    const last = getMangaProgress(m.id);
    box.innerHTML = `<div class="chapters-head"><h2>Chapters</h2><span>${list.length} available</span></div><div class="chapter-list">` +
      [...list].reverse().map(c => `<button class="chapter-row ${c.id === last ? 'read' : ''}" onclick="readManga(activeDetail,'${c.id}')"><span class="chapter-num">${escHtml(chapterLabel(c))}</span><span class="chapter-title">${escHtml(c.title || '')}</span><span class="chapter-pages">${c.pages} pages</span></button>`).join('') + '</div>';
  } catch (e) {
    if (activeDetail && activeDetail.id === m.id) box.innerHTML = '<div class="state error">Could not load chapters. Please try again in a moment.</div>';
  }
}
async function readManga(item, chapterId, silent) {
  if (!item) return;
  try {
    const chapters = await getMangaChapters(item.id);
    if (!chapters.length) { alert('No English chapters are available for this title yet.'); return; }
    let idx = chapterId ? chapters.findIndex(c => c.id === chapterId) : -1;
    if (idx < 0) idx = Math.max(0, chapters.findIndex(c => c.id === getMangaProgress(item.id)));
    let saver = false; try { saver = localStorage.getItem(MANGA_SAVER) === '1'; } catch (_) {}
    reader = { item: serialMedia(item), chapters, idx, saver };
    await loadReaderChapter(idx, silent);
  } catch (e) { alert('Could not open this manga right now. Please try again.'); }
}
function updateReaderNav() {
  const first = reader.idx <= 0, last = reader.idx >= reader.chapters.length - 1;
  ['readerPrev', 'readerPrev2'].forEach(id => { $(id).disabled = first; });
  ['readerNext', 'readerNext2'].forEach(id => { $(id).disabled = last; });
  $('readerQuality').textContent = 'Data saver: ' + (reader.saver ? 'on' : 'off');
}
async function loadReaderChapter(idx, silent) {
  if (!reader || idx < 0 || idx >= reader.chapters.length) return;
  reader.idx = idx;
  const c = reader.chapters[idx], token = ++readerToken;
  if (!silent) pushHist({ kind: 'reader', media: reader.item, chapterId: c.id });
  closeSearch(); toggleProfileMenu(true); setNav('manga');
  $('readerView').classList.remove('comic');
  $('readerTitle').textContent = reader.item._title;
  $('readerChapter').textContent = [chapterLabel(c), c.title].filter(Boolean).join(' · ');
  $('readerSelect').innerHTML = reader.chapters.map((x, i) => `<option value="${i}" ${i === idx ? 'selected' : ''}>${escHtml([chapterLabel(x), x.title].filter(Boolean).join(' · '))}</option>`).join('');
  updateReaderNav();
  $('readerPages').innerHTML = '<div class="state">Loading pages…</div>';
  showPage('readerView');
  setMangaProgress(reader.item.id, c.id);
  rememberContinue(reader.item);
  try {
    const res = await fetch('/api/manga?op=pages&id=' + encodeURIComponent(c.id));
    if (!res.ok) throw new Error('pages ' + res.status);
    const d = await res.json();
    if (token !== readerToken) return;
    const main = reader.saver && d.saver?.length ? d.saver : d.pages;
    const alt = main === d.pages ? (d.saver || []) : d.pages;
    $('readerPages').innerHTML = (main || []).map((u, i) => `<img class="reader-page" src="${escAttr(u)}" data-alt="${escAttr(alt[i] || '')}" alt="Page ${i + 1}" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async" onerror="readerImgFallback(this)">`).join('') || '<div class="state">This chapter has no pages.</div>';
  } catch (e) {
    if (token === readerToken) $('readerPages').innerHTML = '<div class="state error">Could not load this chapter.<br><button class="load-more" style="margin-top:14px" onclick="loadReaderChapter(reader.idx,true)">Try again</button></div>';
  }
}
async function readComic(item, silent) {
  if (!item) return;
  const it = serialMedia(item), token = ++readerToken;
  reader = null;
  if (!silent) pushHist({ kind: 'comic', media: it });
  closeSearch(); toggleProfileMenu(true); setNav('manga');
  $('readerView').classList.add('comic');
  $('readerTitle').textContent = it._title;
  $('readerChapter').textContent = it.seasonYear || '';
  $('readerPages').innerHTML = '<div class="state">Loading pages…</div>';
  showPage('readerView');
  rememberContinue(it);
  let pages = 0;
  try { pages = Number((await comicsApi({ op: 'detail', id: it.id }))?.item?.pages) || 0; } catch (_) {}
  if (token !== readerToken) return;
  const known = pages > 0, count = known ? pages : 150; // unknown length: try a lot, unused slots remove themselves
  const src = n => `https://iiif.archive.org/iiif/${encodeURIComponent(it.id)}$${n}/full/1100,/0/default.jpg`;
  $('readerPages').innerHTML = Array.from({ length: count }, (_, i) =>
    `<img class="reader-page" src="${escAttr(src(i))}" alt="Page ${i + 1}" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async" onerror="comicPageError(this,${known})">`).join('');
}
function comicPageError(img, known) {
  if (!known) { img.remove(); return; }
  img.classList.add('failed');
  img.alt = 'This page did not load. Tap to retry.';
  img.onclick = () => { const s = img.src; img.classList.remove('failed'); img.src = ''; img.src = s; };
}
function readerGo(delta) { if (reader) loadReaderChapter(reader.idx + delta); }
function toggleReaderQuality() {
  if (!reader) return;
  reader.saver = !reader.saver;
  try { localStorage.setItem(MANGA_SAVER, reader.saver ? '1' : '0'); } catch (_) {}
  loadReaderChapter(reader.idx, true);
}
function readerImgFallback(img) {
  const alt = img.dataset.alt;
  if (alt && img.src !== alt) { img.dataset.alt = ''; img.src = alt; return; }
  img.classList.add('failed');
  img.alt = 'This page did not load. Tap to retry.';
  img.onclick = () => { const s = img.src; img.classList.remove('failed'); img.src = ''; img.src = s; };
}

function openMyList(silent=false) {
  if(!silent && !applyingHistory) pushHist({kind:'mylist'});
  closeSearch();toggleProfileMenu(true);setNav('mylist');
  renderMyList();showPage('myListView');
}
function filterMyList(filter) {
  listFilter=filter;
  document.querySelectorAll('[data-list-filter]').forEach(el=>el.classList.toggle('active',el.dataset.listFilter===filter));
  renderMyList();
}
function myListEmptyHTML(filter) {
  const copy = {
    all:   ['Your list starts here', 'Save any movie, series or anime and it will stay in this library on this device.', 'Discover titles', "nav('home')"],
    anime: ['No anime saved yet', 'Save anime you want to come back to on this device.', 'Explore anime', "nav('anime')"],
    tv:    ['No series saved yet', 'Save series you want to come back to on this device.', 'Explore series', "nav('series')"],
    movie: ['No movies saved yet', 'Save movies you want to come back to on this device.', 'Explore movies', "nav('movies')"],
    manga: ['No manga saved yet', 'Open any manga and tap My List to keep it here.', 'Explore manga', "nav('manga')"],
    comic: ['No comics saved yet', 'Open any comic and tap My List to keep it here.', 'Explore comics', "nav('manga','comic')"]
  }[filter] || ['Your list starts here', 'Add titles to My List and they stay saved on this device.', 'Explore anime', "nav('anime')"];
  return `<div class="empty-collection"><span class="empty-icon"><i class="ri-bookmark-line" aria-hidden="true"></i></span><h2>${copy[0]}</h2><p>${copy[1]}</p><button onclick="${copy[3]}">${copy[2]}</button></div>`;
}
function renderMyList() {
  const all=allMedia(getSavedList());
  setCollectionArt(all);
  const list=listFilter==='all'?all:all.filter(item=>(item._type||item.type)===listFilter);
  $('myListCount').textContent=`${all.length} saved title${all.length===1?'':'s'}`;
  $('myListGrid').innerHTML=list.length?list.map(cardHTML).join(''):myListEmptyHTML(listFilter);
  updateSavedCount();
  backfillStoredArtwork('animestream.mylist.v1');
}
function openContinue(silent=false) {
  if(!silent && !applyingHistory) pushHist({kind:'continue'});
  closeSearch();toggleProfileMenu(true);setNav('');
  const list=allMedia(getContinueList());
  setCollectionArt(list);
  $('continueGrid').innerHTML=list.length?list.map(cardHTML).join(''):`<div class="empty-collection"><span class="empty-icon"><i class="ri-history-line" aria-hidden="true"></i></span><h2>Nothing playing yet</h2><p>When you start a title, it will appear here so you can jump back in quickly.</p><button onclick="goHome()">Discover something</button></div>`;
  showPage('continueView');
  backfillStoredArtwork('animestream.continue.v1');
}
function toggleProfileMenu(forceClose=false) {
  const menu=$('profileMenu'); if(!menu) return;
  if(forceClose) menu.classList.remove('open'); else menu.classList.toggle('open');
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.profile-menu')&&!e.target.closest('.profile-trigger')) toggleProfileMenu(true);
});
window.addEventListener('storage',e=>{ if(e.key==='animestream.mylist.v1') updateSavedCount(); });
