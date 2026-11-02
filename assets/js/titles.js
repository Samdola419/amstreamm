/* ----------------------------------------------------------------------
   AnimeStream watch flows: movies, series, anime; seasons; progress memory
   ---------------------------------------------------------------------- */

function openMovie(tmdb, imdb, title, silent) {
  if (!silent) pushHist({ kind: 'player', playerType: 'movie', tmdb, imdb, title });
  closeSearch(); showPlayer();
  const id = imdb || tmdb;
  current = { type: 'movie', tmdb, imdb, id, title, embed: '', sourceItem: movieCache.find(m=>(imdb&&m.imdb===imdb)||(tmdb&&m.tmdb===tmdb)) || {_type:'movie',id,tmdb,imdb,_title:title} };
  rememberContinue(current.sourceItem);
  const cached = movieCache.find(m => (imdb && m.imdb === imdb) || (tmdb && m.tmdb === tmdb));
  if (cached?.embed) current.embed = cached.embed;
  serverIdx = 0;
  $('mediaTitle').textContent = title;
  $('mediaMeta').textContent = 'Movie · if the player is blank, tap another server';
  setEpisodeMode(false);
  $('playerControls').innerHTML = ''; $('animeSeasons').innerHTML = '';
  renderServers(MOVIE_SERVERS);
  loadMovieServer();
  loadUpNext('related');
}
function loadMovieServer() {
  const srv = MOVIE_SERVERS[serverIdx] || MOVIE_SERVERS[0];
  const url = srv.url(current);
  if (!url || url.endsWith('/undefined') || url.endsWith('/')) {
    $('mediaMeta').textContent = 'No playable id for this title';
    return;
  }
  playNow(url);
}

async function openTv(imdb, tvmazeId, title, silent) {
  if (!silent) pushHist({ kind: 'player', playerType: 'tv', imdb, tvmaze: tvmazeId, title });
  closeSearch(); showPlayer();
  current = { type: 'tv', imdb, tvmaze: tvmazeId, id: imdb, title, seasons: {}, seasonList: [], sourceItem: seriesCache.find(m=>String(m.tvmaze||m.id)===String(tvmazeId)) || {_type:'tv',id:tvmazeId,imdb,tvmaze:tvmazeId,_title:title} };
  rememberContinue(current.sourceItem);
  season = 1; epIndex = 0; serverIdx = 0;
  $('mediaTitle').textContent = title;
  $('mediaMeta').textContent = 'Loading…';
  setEpisodeMode(true);
  $('playerControls').innerHTML = ''; $('animeSeasons').innerHTML = '';
  renderServers(TV_SERVERS);
  loadUpNext('related');

  if (tvmazeId && String(tvmazeId).match(/^\d+$/)) {
    try {
      const [eps, show] = await Promise.all([
        fetch(`${TVMAZE}/shows/${tvmazeId}/episodes`).then(r => r.json()),
        fetch(`${TVMAZE}/shows/${tvmazeId}`).then(r => r.ok ? r.json() : null).catch(() => null)
      ]);
      const bySeason = {};
      for (const e of eps) {
        if (!e.season || !e.number) continue;
        if (!bySeason[e.season]) bySeason[e.season] = [];
        bySeason[e.season].push(e);
      }
      current.seasons = bySeason;
      current.seasonList = Object.keys(bySeason).map(Number).sort((a, b) => a - b);
      season = current.seasonList[0] || 1;
      const savedTv = getProgress('tv', tvmazeId || imdb);
      if (savedTv && current.seasons[savedTv.s]?.[savedTv.e]) { season = savedTv.s; epIndex = savedTv.e; showResumeNote(`Resuming from Season ${season}, Episode ${epIndex + 1}`); }
      $('mediaMeta').textContent = `${current.seasonList.length} season${current.seasonList.length > 1 ? 's' : ''} · ${eps.length} episodes`;
      $('playerControls').innerHTML = current.seasonList.slice(0, 24).map(s =>
        `<button class="season-btn ${s === season ? 'active' : ''}" onclick="setSeason(${s})">S${s}</button>`
      ).join('');
      renderTvEps(); loadTvServer();
      if (show?.image) rememberContinue(mapTvmaze({ ...show, externals: show.externals || { imdb } })); // refresh the stored card with real artwork
      return;
    } catch (e) { $('mediaMeta').textContent = e.message; }
  }
  current.seasons = { 1: Array.from({ length: 12 }, (_, i) => ({ number: i + 1, name: `Episode ${i + 1}` })) };
  current.seasonList = [1]; season = 1;
  $('mediaMeta').textContent = 'Series';
  renderTvEps(); loadTvServer();
}
function setSeason(s) {
  season = s;
  document.querySelectorAll('.season-btn').forEach(el => el.classList.toggle('active', el.textContent === `S${s}`));
  epIndex = 0; renderTvEps(); loadTvServer();
}
function renderTvEps() {
  const list = current.seasons[season] || [];
  $('episodeList').innerHTML = list.map((e, i) => {
    const num = e.number || i + 1;
    return `<div class="ep ${i === epIndex ? 'active' : ''}" onclick="playTv(${i})"><span class="ep-num">E${num}</span><span>${e.name || 'Episode ' + num}</span></div>`;
  }).join('') || '<div class="state">No episodes</div>';
}
function playTv(i) {
  epIndex = i;
  document.querySelectorAll('.ep').forEach((el, idx) => el.classList.toggle('active', idx === i));
  loadTvServer();
}
function loadTvServer() {
  if (!current || current.type !== 'tv') return;
  const list = current.seasons[season] || [];
  const num = list[epIndex]?.number || epIndex + 1;
  const id = current.imdb || current.tmdb || current.id;
  if (!id) return alert('No stream ID');
  saveProgress({ s: season, e: epIndex });
  const srv = TV_SERVERS[serverIdx] || TV_SERVERS[0];
  playNow(srv.url(id, season, num));
}

async function openAnime(aniId, malId, title, episodes, silent) {
  if (!silent) pushHist({ kind: 'player', playerType: 'anime', aniId, malId, title, episodes });
  closeSearch(); showPlayer();
  const openedId = aniId;
  const saved = getProgress('anime', openedId);
  let startEp = saved && saved.e > 0 ? saved.e : 0;
  if (saved && saved.ani && String(saved.ani) !== String(aniId)) { aniId = saved.ani; malId = 0; } // last watched a later season
  serverIdx = 0;
  $('mediaTitle').textContent = title;
  $('mediaMeta').textContent = 'Loading…';
  setEpisodeMode(true);
  lang = saved?.lang === 'dub' ? 'dub' : 'sub'; epIndex = startEp;
  current = { type: 'anime', ani_id: aniId, openedId, mal_id: malId, imdb: '', tmdb: '', title, episodes: episodes || 12 };
  rememberContinue({ _type:'anime', id:openedId, idMal:malId, _title:title, episodes:episodes||12 });
  $('playerControls').innerHTML = `<button class="lang-btn ${lang === 'sub' ? 'active' : ''}" id="btnSub" onclick="setLang('sub')">SUB</button>
    <button class="lang-btn ${lang === 'dub' ? 'active' : ''}" id="btnDub" onclick="setLang('dub')">DUB</button>`;
  renderServers(ANIME_SERVERS); // viewers can switch server manually if one misses their title
  try {
    const [info, map] = await Promise.all([
      anilist(Q_ANIME_INFO, { id: aniId }).catch(() => null),
      fetch(`https://api.ani.zip/mappings?anilist_id=${aniId}`).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);
    const m = info?.Media;
    const maps = map?.mappings || {};
    current = {
      type: 'anime',
      openedId,
      ani_id: m?.id || aniId,
      mal_id: m?.idMal || maps.mal_id || malId,
      imdb: maps.imdb_id || '',
      tmdb: maps.themoviedb_id || '',
      title: m ? titleOf(m) : title,
      episodes: m?.episodes || map?.episodeCount || episodes || 24,
      genres: m?.genres || []
    };
    current.epTitles = map?.episodes || {};
    let n = current.episodes; if (!n || n < 1) n = 12; if (n > 2000) n = 2000;
    current.episodes = n;
    startEp = Math.min(startEp, n - 1);
    $('mediaTitle').textContent = current.title;
    $('mediaMeta').textContent = [m?.seasonYear, m?.averageScore ? `★ ${(m.averageScore/10).toFixed(1)}` : '', (m?.genres||[]).slice(0,4).join(', '), n + ' eps'].filter(Boolean).join(' · ');
    if (m) rememberContinue({ ...mapAnime(m), id: openedId, ani_id: current.ani_id, idMal: current.mal_id, episodes: current.episodes }); // store the rich card with its poster
  } catch (e) {
    $('mediaMeta').textContent = (current.episodes || 12) + ' episodes';
  }
  epIndex = startEp;
  renderAnimeEps();
  playAnime(startEp);
  if (startEp > 0) showResumeNote(`Resuming from Episode ${startEp + 1}`);
  loadAnimeSeasons(current);
  loadUpNext('related');
}
const ANIME_TV_FORMATS = new Set(['TV','TV_SHORT','ONA']);
function animeEpTitle(n) {
  const t = current?.epTitles?.[String(n)]?.title;
  return t ? (t.en || t['x-jat'] || t.ja || '') : '';
}
async function animeRelations(id) {
  const d = await anilist(Q_ANIME_REL, { id }).catch(() => null);
  const m = d?.Media;
  if (!m) return null;
  const edges = m.relations?.edges || [];
  const pick = type => edges.find(e => e.relationType === type && e.node?.type === 'ANIME' && ANIME_TV_FORMATS.has(e.node.format))?.node;
  return { node: m, prequel: pick('PREQUEL'), sequel: pick('SEQUEL') };
}
// Builds S1, S2, S3... by following AniList prequel/sequel links; playback is never blocked on this.
async function loadAnimeSeasons(owner) {
  if (!owner?.ani_id) return;
  try {
    const first = await animeRelations(owner.ani_id);
    if (!first || current !== owner) return;
    const seen = new Set([first.node.id]), chain = [first.node];
    let back = first, hops = 0;
    while (back.prequel && !seen.has(back.prequel.id) && hops++ < 8) {
      const r = await animeRelations(back.prequel.id);
      if (!r) break;
      seen.add(r.node.id); chain.unshift(r.node); back = r;
    }
    let fwd = first; hops = 0;
    while (fwd.sequel && !seen.has(fwd.sequel.id) && hops++ < 8) {
      const r = await animeRelations(fwd.sequel.id);
      if (!r) break;
      seen.add(r.node.id); chain.push(r.node); fwd = r;
    }
    if (current !== owner) return;
    owner.seasons = chain;
    owner.seasonIdx = Math.max(0, chain.findIndex(s => s.id === first.node.id));
    renderAnimeSeasons();
  } catch (e) { console.warn('Anime seasons unavailable', e); }
}
function renderAnimeSeasons() {
  const box = $('animeSeasons');
  if (!box) return;
  const list = current?.type === 'anime' ? (current.seasons || []) : [];
  if (list.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = list.map((s, i) =>
    `<button class="season-btn ${i === current.seasonIdx ? 'active' : ''}" onclick="setAnimeSeason(${i})" title="${escAttr(titleOf(s))}">S${i + 1}</button>`
  ).join('');
}
function setAnimeSeason(i) {
  const c = current;
  if (!c || c.type !== 'anime' || !c.seasons?.[i]) return;
  const s = c.seasons[i];
  c.seasonIdx = i; c.ani_id = s.id; c.mal_id = s.idMal || 0; c.imdb = ''; c.tmdb = '';
  c.episodes = Math.min(Math.max(s.episodes || 12, 1), 2000); c.epTitles = {};
  epIndex = 0;
  $('mediaMeta').textContent = [titleOf(s), s.seasonYear, c.episodes + ' eps'].filter(Boolean).join(' · ');
  renderAnimeSeasons(); renderAnimeEps(); playAnime(0);
  fetch(`https://api.ani.zip/mappings?anilist_id=${s.id}`).then(r => r.ok ? r.json() : null).then(map => {
    if (!map || current !== c || c.ani_id !== s.id) return;
    c.epTitles = map.episodes || {};
    if (!s.episodes && map.episodeCount) c.episodes = Math.min(map.episodeCount, 2000);
    renderAnimeEps();
  }).catch(() => {});
}
function renderAnimeEps() {
  const n = current.episodes || 12;
  let html = '';
  for (let i = 0; i < n; i++) {
    html += `<div class="ep ${i===epIndex?'active':''}" onclick="playAnime(${i})"><span class="ep-num">Ep ${i+1}</span><span>${escHtml(animeEpTitle(i+1) || 'Episode ' + (i+1))}</span></div>`;
  }
  $('episodeList').innerHTML = html;
}
function playAnime(i) {
  if (!current || current.type !== 'anime') return;
  epIndex = i;
  saveProgress({ e: i, ani: current.ani_id, lang });
  document.querySelectorAll('.ep').forEach((el, idx) => el.classList.toggle('active', idx === i));
  const ep = i + 1;
  const srv = ANIME_SERVERS[serverIdx] || ANIME_SERVERS[0];
  const url = srv.url(current, ep, lang);
  if (!url) {
    serverIdx = 0;
    playAnime(i); // this server has no id for the title — start MegaPlay instead
    return;
  }
  playNow(url);
}
function setLang(l) {
  lang = l;
  $('btnSub')?.classList.toggle('active', l === 'sub');
  $('btnDub')?.classList.toggle('active', l === 'dub');
  playAnime(epIndex);
}

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
    genres:(Array.isArray(m.genres) ? m.genres : Array.isArray(m._genres) ? m._genres : []).slice(0,8), _src:m._src || ''
  };
}
function mediaKey(item) {
  const m = item || {};
  return `${m._type || m.type || 'anime'}:${m.id || m.imdb || m.tmdb || m.tvmaze || m._title || m.title || ''}`.toLowerCase();
}
function getSavedList() { return safeReadStore('animestream.mylist.v1', []); }
function isSaved(item) { const key=mediaKey(item); return getSavedList().some(m=>mediaKey(m)===key); }
function updateSavedCount() { const el=$('savedCount'); if(el) el.textContent=String(animeOnly(getSavedList()).length); }
function toggleSaved(item) {
  const normalized=serialMedia(item), list=getSavedList(), key=mediaKey(normalized);
  if(!isSaveableType(normalized._type)) return false; // manga/comics stay out of My List
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
  const list = safeReadStore(storeKey, []).filter(it => isSaveableType(it?._type || it?.type));
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
  if (currentScreenId === 'continueView') { const list = getContinueList(); setCollectionArt(list); $('continueGrid').innerHTML = list.length ? list.map(cardHTML).join('') : $('continueGrid').innerHTML; }
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
    else if (current.type === 'movie') keys.add('movie:' + (current.imdb || current.openedId || ''));
    keys.forEach(k => { if (!k.endsWith(':') && !k.endsWith(':undefined')) all[k] = { ...(all[k] || {}), ...patch, t: Date.now() }; });
    const entries = Object.entries(all).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, 200);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (_) { /* storage disabled */ }
}
function progressLabel(item) {
  const type = item?._type || item?.type;
  if (type === 'movie') {
    const pr = getProgress('movie', item.imdb || '');
    if (!pr) return '';
    if (pr.dur > 0 && pr.p > 30) return `${Math.max(1, Math.round(pr.p / pr.dur * 100))}% watched`;
    if (pr.p > 30) return `${Math.max(1, Math.round(pr.p / 60))} min watched`;
    return '';
  }
  if (type !== 'anime' && type !== 'tv') return '';
  const pr = getProgress(type, type === 'tv' ? (item.tvmaze || item.id) : item.id);
  if (!pr || pr.e == null) return '';
  return type === 'tv' ? `S${pr.s || 1} E${pr.e + 1}` : `Episode ${pr.e + 1}`;
}
function getContinueList() { return safeReadStore('animestream.continue.v1', []); }
// History saves anime, movies and series; manga and comics stay out of the lists.
const SAVEABLE_TYPES = ['anime','movie','tv'];
const isSaveableType = t => SAVEABLE_TYPES.includes(String(t || 'anime').toLowerCase());
const animeOnly = list => (list || []).filter(t => isSaveableType(t?._type || t?.type)); // anime, movies and series (name kept for callers)
// Fields that make a stored card look complete: artwork, description, badges.
const RICH_FIELDS = ['_poster','_posterFallback','_backdrop','bannerImage','summary','description','_sub','seasonYear','averageScore','episodes','genres'];
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
  const type=String(m._type || 'anime').toLowerCase();
  if(type==='manga' || type==='comic') return; // manga & comics are read, never tracked here
  if(!key.replace(/^[a-z]+:/,'')) return; // no usable id
  const list=getContinueList();
  const stored=list.find(x=>mediaKey(x)===key);
  const filtered=list.filter(x=>mediaKey(x)!==key);
  filtered.unshift({ ...mergeRich(m,stored), _updatedAt:Date.now() });
  safeWriteStore('animestream.continue.v1',filtered.slice(0,30));
}
function playItem(item) {
  if(!item) return;
  const type=item._type || item.type;
  if(type==='anime') {
    const upcoming = (!item.episodes && item.nextAiringEpisode) || item.status === 'NOT_YET_RELEASED';
    if (upcoming) {
      flashNote(`${item._title || item.title || 'This title'} is not out yet \u2014 ${airingLabel(item)}. You already saved the status \u2014 reopen this page to check.`);
      return;
    }
    openAnime(item.id || item.ani_id || item.aniId, item.idMal || item.mal_id || item.malId || 0, item._title || item.title, item.episodes || 12);
  }
  else if(type==='movie') openMovie(item.tmdb || item.id, item.imdb || '', item._title || item.title);
  else if(type==='manga') readManga(item);
  else if(type==='comic') readComic(item);
  else openTv(item.imdb || '', String(item.tvmaze || item.id || ''), item._title || item.title);
}
