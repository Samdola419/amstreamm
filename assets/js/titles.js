/* ----------------------------------------------------------------------
   AnimeStream watch flows: movies, series, anime; seasons; progress memory
   ---------------------------------------------------------------------- */

function openMovie(tmdb, imdb, title, silent) {
  // Call sites hand us (tmdb, imdb) in mixed shapes. Normalize here so a tt id
  // never rides in the TMDB slot: VidSpark's embeds pass tt ids to a second
  // player that refuses sandboxed frames (the "sandbox detected" dead screen).
  let t = String(tmdb ?? ''), i = String(imdb ?? '');
  if (/^tt\d+$/i.test(t)) { i = i || t; t = ''; }
  if (/^tt\d+$/i.test(i)) {
    if (!/^\d+$/.test(t)) t = '';
  } else if (/^\d+$/.test(i) && !(Number(t) || 0)) {
    // numeric value found in the imdb slot is really a tmdb id
    t = i; i = '';
  } else {
    i = '';
  }
  if (!/^\d+$/.test(t)) t = '';
  tmdb = Number(t) || 0;
  imdb = i;
  if (!silent) pushHist({ kind: 'player', playerType: 'movie', tmdb, imdb, title });
  closeSearch(); showPlayer();
  const id = imdb || tmdb;
  current = { type: 'movie', tmdb, imdb, id, title, embed: '', sourceItem: movieCache.find(m=>(imdb&&m.imdb===imdb)||(tmdb&&m.tmdb===tmdb)) || {_type:'movie',id,tmdb,imdb,_title:title} };
  rememberContinue(current.sourceItem);
  const cached = movieCache.find(m => (imdb && m.imdb === imdb) || (tmdb && m.tmdb === tmdb));
  if (cached?.embed) current.embed = cached.embed;
  serverIdx = 0;
  $('mediaTitle').textContent = title;
  $('mediaMeta').textContent = 'Movie';
  setEpisodeMode(false);
  $('playerControls').innerHTML = ''; $('animeSeasons').innerHTML = '';
  renderServers(MOVIE_SERVERS);
  loadMovieServer();
  loadUpNext('related');
}
function loadMovieServer() {
  if (!current || current.type !== 'movie') return;
  if (!current.tmdb && current.imdb && !current._tmdbTried) {
    current._tmdbTried = true;
    resolveMovieTmdb().then(id => {
      if (!current || current.type !== 'movie') return;
      loadMovieServer();
    }).catch(() => { if (current && current.type === 'movie') playMovieNow(); });
    return;
  }
  playMovieNow();
}
function playMovieNow() {
  if (!current || current.type !== 'movie') return;
  // Only TMDB ids reach the player: an imdb id is handed to a second player that
  // refuses sandboxed frames (dead screen). Titles without a TMDB match stay
  // honest instead of loading a doomed frame.
  if (!current.tmdb) {
    $('mediaMeta').textContent = 'No stream for this title. Try another movie.';
    return;
  }
  const srv = MOVIE_SERVERS[serverIdx] || MOVIE_SERVERS[0];
  playNow(srv.url(current));
}

async function openTv(imdb, tvmazeId, title, silent) {
  if (!silent) pushHist({ kind: 'player', playerType: 'tv', imdb, tvmaze: tvmazeId, title });
  closeSearch(); showPlayer();
  const tvSource = seriesCache.find(m=>String(m.tvmaze||m.id)===String(tvmazeId)) || {_type:'tv',id:tvmazeId,imdb,tvmaze:tvmazeId,_title:title};
  current = { type: 'tv', imdb, tmdb: tvSource.tmdb || '', tvmaze: tvmazeId, id: imdb, title, seasons: {}, seasonList: [], sourceItem: tvSource };
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
  // vidsrc.pm's native player (the sandbox-safe one) needs a TMDB id for series;
  // an IMDB id is handed to a second player that refuses sandboxed frames.
  // Cinemeta is CORS-open and already a site dependency, so resolve it in the browser.
  if (!current.tmdb && current.imdb && !current._tmdbTried) {
    current._tmdbTried = true;
    resolveTvTmdb().then(id => {
      if (!current || current.type !== 'tv') return;
      if (id) loadTvServer(); else playTvNow();
    }).catch(() => { if (current && current.type === 'tv') playTvNow(); });
    return;
  }
  playTvNow();
}
async function cinemetaTmdb(kind, imdb) {
  if (!imdb || !/^tt\d+$/.test(imdb)) return '';
  const key = `animestream.tmdb.${kind}.v1:${imdb}`;
  try { const hit = localStorage.getItem(key); if (hit) return hit; } catch (_) {}
  try {
    const res = await fetch(`${CINEMETA}/meta/${kind}/${imdb}.json`);
    if (!res.ok) return '';
    const meta = (await res.json()).meta || {};
    const id = meta.moviedb_id ? String(meta.moviedb_id) : '';
    if (id) { try { localStorage.setItem(key, id); } catch (_) {} }
    return id;
  } catch (_) { return ''; }
}
async function resolveTvTmdb() {
  if (!current || current.type !== 'tv') return '';
  if (current.tmdb) return current.tmdb;
  const id = await cinemetaTmdb('series', current.imdb);
  if (id) current.tmdb = id;
  return id;
}
async function resolveMovieTmdb() {
  if (!current || current.type !== 'movie') return '';
  if (current.tmdb) return current.tmdb;
  const id = await cinemetaTmdb('movie', current.imdb);
  if (id) current.tmdb = id;
  return id;
}
function playTvNow() {
  if (!current || current.type !== 'tv') return;
  // Only TMDB ids reach the player (imdb ids load a sandbox-refusing player).
  if (!current.tmdb) {
    $('mediaMeta').textContent = 'No stream for this show. Try another title.';
    return;
  }
  const list = current.seasons[season] || [];
  const num = list[epIndex]?.number || epIndex + 1;
  saveProgress({ s: season, e: epIndex });
  const srv = TV_SERVERS[serverIdx] || TV_SERVERS[0];
  playNow(srv.url(current.tmdb, season, num));
}

// AniPub's public API documents direct, CORS-enabled streaming iframe links:
// /api/find/:name -> numeric ID, then /v1/api/details/:id -> local.link (EP1)
// and local.ep[] (EP2+). The returned src= prefix is stripped before embedding.
const ANIPUB_BASE = 'https://anipub.org';
const ANIPUB_ID_CACHE_PREFIX = 'animestream.anipub.id.v1:';
const ANIPUB_ID_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
let anipubPlayRequest = 0;

function anipubNormalizeTitle(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function anipubTitleCandidates(media, fallback) {
  const values = [
    fallback,
    media?.title?.english,
    media?.title?.romaji,
    media?.title?.native,
    ...(Array.isArray(media?.synonyms) ? media.synonyms : [])
  ];
  const seen = new Set();
  return values.map(v => String(v || '').trim()).filter(v => {
    const key = anipubNormalizeTitle(v);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function anipubCacheKey(owner) {
  return ANIPUB_ID_CACHE_PREFIX + String(owner?.ani_id || anipubNormalizeTitle(owner?.title) || 'unknown');
}
function readAniPubIdCache(owner) {
  try {
    const data = JSON.parse(localStorage.getItem(anipubCacheKey(owner)) || 'null');
    return data && Number.isInteger(Number(data.id)) && Number(data.id) > 0 && data.expiresAt > Date.now()
      ? Number(data.id) : 0;
  } catch (_) { return 0; }
}
function writeAniPubIdCache(owner, id, matchedTitle) {
  try {
    localStorage.setItem(anipubCacheKey(owner), JSON.stringify({
      id: Number(id), matchedTitle: String(matchedTitle || ''), expiresAt: Date.now() + ANIPUB_ID_CACHE_TTL
    }));
  } catch (_) { /* Private browsing or full storage: resolve again next time. */ }
}
async function anipubJson(path) {
  const response = await fetch(ANIPUB_BASE + path, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Stream lookup failed (${response.status}).`);
  return response.json();
}
async function findAniPubAnime(owner) {
  if (owner.anipubId) return Number(owner.anipubId);
  const cached = readAniPubIdCache(owner);
  if (cached) { owner.anipubId = cached; return cached; }

  const candidates = Array.isArray(owner.anipubTitles) && owner.anipubTitles.length
    ? owner.anipubTitles
    : anipubTitleCandidates({
        title: { english: owner.title, romaji: owner.romaji, native: owner.nativeTitle },
        synonyms: owner.synonyms
      }, owner.title);

  // Prefer AniPub's documented exact-title finder. Try alternate AniList titles
  // and synonyms only when the primary title is not in AniPub's catalogue.
  for (const title of candidates) {
    try {
      const found = await anipubJson('/api/find/' + encodeURIComponent(title));
      const id = Number(found?.id);
      if (found?.exist === true && Number.isInteger(id) && id > 0) {
        owner.anipubId = id;
        writeAniPubIdCache(owner, id, title);
        return id;
      }
    } catch (_) { /* Try the next known title spelling. */ }
  }

  // The documented quick-search endpoint can expose the exact catalogue title
  // when a title finder spelling differs; still require an exact normalized match.
  for (const title of candidates.slice(0, 3)) {
    try {
      const results = await anipubJson('/api/search/' + encodeURIComponent(title));
      const hit = Array.isArray(results) ? results.find(item =>
        anipubNormalizeTitle(item?.Name) === anipubNormalizeTitle(title)
      ) : null;
      const id = Number(hit?.Id ?? hit?.id ?? hit?._id);
      if (hit && Number.isInteger(id) && id > 0) {
        owner.anipubId = id;
        writeAniPubIdCache(owner, id, hit.Name || title);
        return id;
      }
    } catch (_) { /* Keep checking known aliases. */ }
  }
  throw new Error('This title is not available to stream yet.');
}
function anipubEmbedUrl(value) {
  let raw = String(value || '').trim().replace(/^src=/i, '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, ANIPUB_BASE);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.href;
  } catch (_) { return ''; }
}

// ---- Playback: MegaPlay's own player (no AniPub hop, no ads, no redirects) ----
// AniPub is only used to find which title you clicked. Playback resolves the MAL id and
// asks MegaPlay for the episode directly: megaplay.buzz/stream/mal/<mal>/<ep>/<sub|dub>.
// (AniPub's /video/<id>/<dir> pages are shells around the s-2 flavour of the same player;
// its older episodes even point at gogoanime/kwik/bunnycdn, which is why clicking those
// used to punt viewers onto ad pages.)
//
// Every embed goes through /megaplay.html, whose URL carries a partner token: MegaPlay's
// ad engine gates on document.referrer (a substring match against its whitelist), so with
// that referrer the popunder/redirect script (nekostream 3p.js) is never injected at all.
const ANIPUB_PARTNER_TOKEN = 'anichi.to'; // MegaPlay's no-ads whitelisted domain
const MEGA_BASE = 'https://megaplay.buzz';
const MEGA_PROBE_PREFIX = 'animestream.mega.v2:';
const MEGA_PROBE_TTL = 24 * 60 * 60 * 1000;

function megaShimSrc(streamUrl) {
  if (!streamUrl) return '';
  return '/megaplay.html?src=' + encodeURIComponent(streamUrl) + '&partner=' + ANIPUB_PARTNER_TOKEN + '&rb=4';
}
function anipubVideoId(url) {
  const m = /^https?:\/\/(?:www\.)?anipub\.org\/video\/([^/]+)\/(?:sub|dub)\b/i.exec(String(url || ''));
  return m ? m[1] : '';
}
// MegaPlay serves its stream page CORS-open, and the <title> is the availability answer:
// "File <id> - MegaPlay" = this exact episode + language exists, "Error - MegaPlay" = not.
function readMegaProbe(key) {
  try {
    const d = JSON.parse(localStorage.getItem(MEGA_PROBE_PREFIX + key) || 'null');
    return d && typeof d.ok === 'boolean' && d.expiresAt > Date.now() ? d.ok : null;
  } catch (_) { return null; }
}
function writeMegaProbe(key, ok) {
  try { localStorage.setItem(MEGA_PROBE_PREFIX + key, JSON.stringify({ ok: !!ok, expiresAt: Date.now() + MEGA_PROBE_TTL })); }
  catch (_) { /* storage unavailable: probe again next time */ }
}
async function probeStreamPage(key, url) {
  const cached = readMegaProbe(key);
  if (cached !== null) return cached;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => { try { ctl.abort(); } catch (_) {} }, 7000) : null;
  try {
    const res = await fetch(url, { headers: { Accept: 'text/html' }, signal: ctl ? ctl.signal : undefined });
    const text = await res.text();
    const m = /<title>([^<]*)<\/title>/i.exec(text);
    const ok = !(m && /error/i.test(m[1]));
    writeMegaProbe(key, ok);
    return ok;
  } catch (_) { return true; } // probe hiccup: let the player try; misses are reported upward
  finally { if (timer) clearTimeout(timer); }
}
function probeMegaEpisode(mal, ep, lang) {
  return probeStreamPage(`m:${mal}:${ep}:${lang}`, `${MEGA_BASE}/stream/mal/${mal}/${ep}/${lang}`);
}
function probeMegaAniEpisode(ani, ep, lang) {
  return probeStreamPage(`i:${ani}:${ep}:${lang}`, `${MEGA_BASE}/stream/ani/${ani}/${ep}/${lang}`);
}
function probeAnipubDub(videoId) {
  return probeStreamPage(`a:${videoId}:dub`, `${MEGA_BASE}/stream/s-2/${videoId}/dub`);
}
// Preferred source: MegaPlay's MAL catalogue (real sub/dub, one clean provider).
function animePlayerSrc(media, ep, lang) {
  const mal = Number(media?.mal_id) || 0;
  if (!mal) return '';
  return megaShimSrc(`${MEGA_BASE}/stream/mal/${mal}/${ep}/${lang === 'dub' ? 'dub' : 'sub'}`);
}
// Second MegaPlay route: their AniList catalogue. It covers titles whose MAL mapping
// is missing or not synced yet (common for OVAs/hentai), without exposing any of it
// in the UI — the viewer just gets the next working player.
function animeAniPlayerSrc(media, ep, lang) {
  const ani = Number(media?.ani_id) || 0;
  if (!ani) return '';
  return megaShimSrc(`${MEGA_BASE}/stream/ani/${ani}/${ep}/${lang === 'dub' ? 'dub' : 'sub'}`);
}
// Fallback source: the AniPub catalogue entry for this episode. AniPub-hosted entries
// resolve to MegaPlay's s-2 page (also cleaned); third-party providers keep their own
// page, which the shim sandboxes so it still cannot navigate or pop up over the viewer.
function anipubPlayerSrc(raw, lang) {
  const id = anipubVideoId(raw);
  if (id) return megaShimSrc(`${MEGA_BASE}/stream/s-2/${id}/${lang === 'dub' ? 'dub' : 'sub'}`);
  return megaShimSrc(raw);
}
function renderAnimeLang(dubNote) {
  const box = $('playerControls');
  if (!box || current?.type !== 'anime') return;
  box.innerHTML =
    `<button type="button" class="lang-btn ${lang === 'sub' ? 'active' : ''}" id="btnSub" onclick="setLang('sub')">SUB</button>` +
    `<button type="button" class="lang-btn ${lang === 'dub' ? 'active' : ''}" id="btnDub" onclick="setLang('dub')"${dubNote ? ` title="${escAttr(dubNote)}"` : ''}>DUB</button>`;
}
async function getAniPubEpisodeUrls(id) {
  const data = await anipubJson('/v1/api/details/' + encodeURIComponent(id));
  const local = data?.local;
  if (!local) throw new Error('No streaming record for this anime.');
  // AniPub's documented numbering: local.link is episode 1; local.ep[0] is episode 2.
  const urls = [anipubEmbedUrl(local.link)];
  (Array.isArray(local.ep) ? local.ep : []).forEach(item => urls.push(anipubEmbedUrl(item?.link)));
  while (urls.length && !urls[urls.length - 1]) urls.pop();
  if (!urls.length || !urls[0]) throw new Error('No playable episode links for this anime yet.');
  return urls;
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
  try { lang = localStorage.getItem('animestream.lang') === 'dub' ? 'dub' : 'sub'; } catch (_) { lang = 'sub'; }
  epIndex = startEp;
  current = { type: 'anime', ani_id: aniId, openedId, mal_id: malId, imdb: '', tmdb: '', title, episodes: episodes || 12, anipubTitles: [title] };
  rememberContinue({ _type:'anime', id:openedId, idMal:malId, _title:title, episodes:episodes||12 });
  $('playerControls').innerHTML = '';
  renderServers(ANIME_SERVERS);
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
      romaji: m?.title?.romaji || '',
      nativeTitle: m?.title?.native || '',
      synonyms: m?.synonyms || [],
      anipubTitles: anipubTitleCandidates(m, title),
      episodes: m?.episodes || map?.episodeCount || episodes || 24,
      seasonYear: m?.seasonYear || '',
      averageScore: m?.averageScore || 0,
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
  renderAnimeLang();
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
// For a title that hasn't aired yet (Coming Soon), walk back through its prequels and return the
// most recent season that HAS aired, so old episodes stay watchable. Returns null if there is none.
async function latestReleasedSeason(id) {
  let cur = id, hops = 0;
  const seen = new Set();
  while (cur && !seen.has(cur) && hops++ < 10) {
    seen.add(cur);
    const d = await anilist(Q_ANIME_REL, { id: cur }).catch(() => null);
    const m = d?.Media;
    if (!m) return null;
    if (m.status !== 'NOT_YET_RELEASED') return m;
    const edges = m.relations?.edges || [];
    const anime = e => e.node?.type === 'ANIME';
    const e = edges.find(e => e.relationType === 'PREQUEL' && anime(e) && ANIME_TV_FORMATS.has(e.node.format))
           || edges.find(e => e.relationType === 'PARENT' && anime(e))
           || edges.find(e => e.relationType === 'PREQUEL' && anime(e));
    cur = e?.node?.id;
  }
  return null;
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
    // Seasons that haven't aired have nothing to play: keep only released ones.
    const released = chain.filter(s => s.status !== 'NOT_YET_RELEASED');
    if (released.length) { chain.length = 0; chain.push(...released); }
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
  c.title = titleOf(s); c.romaji = s.title?.romaji || ''; c.nativeTitle = s.title?.native || '';
  c.synonyms = s.synonyms || []; c.anipubTitles = anipubTitleCandidates(s, c.title);
  c.anipubId = 0; c.anipubEpisodes = null;
  c.episodes = Math.min(Math.max(s.episodes || 12, 1), 2000); c.epTitles = {};
  epIndex = 0;
  $('mediaTitle').textContent = c.title;
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
async function playAnime(i) {
  if (!current || current.type !== 'anime') return;
  const owner = current;
  const request = ++anipubPlayRequest;
  epIndex = Math.max(0, Number(i) || 0);
  saveProgress({ e: epIndex, ani: owner.ani_id });
  document.querySelectorAll('.ep').forEach((el, idx) => el.classList.toggle('active', idx === epIndex));
  $('mediaMeta').textContent = 'Finding a stream…';

  try {
    const episode = epIndex + 1;
    const mal = Number(owner.mal_id) || 0;
    let effectiveLang = lang;
    let dubNote = '';
    let url = '';

    // MegaPlay route 1: MAL catalogue; route 2: AniList catalogue. Both are the same
    // clean embed, and route 2 catches titles their MAL sync is missing (common for
    // OVAs/hentai). They are probed together so an unavailable title fails fast, and
    // only when both miss do we ask AniPub for a listing.
    const routes = [];
    if (mal) routes.push({
      probe: l => probeMegaEpisode(mal, episode, l),
      src: l => animePlayerSrc(owner, episode, l)
    });
    const ani = Number(owner.ani_id) || 0;
    if (ani) routes.push({
      probe: l => probeMegaAniEpisode(ani, episode, l),
      src: l => animeAniPlayerSrc(owner, episode, l)
    });
    const attempts = routes.map(async route => {
      if (lang === 'dub') {
        const [hasDub, hasSub] = await Promise.all([route.probe('dub'), route.probe('sub')]);
        if (hasDub) return { url: route.src('dub'), lang: 'dub', note: '' };
        if (hasSub) return { url: route.src('sub'), lang: 'sub', note: `No dub for Episode ${episode} yet.` };
        return null;
      }
      if (await route.probe('sub')) return { url: route.src('sub'), lang: 'sub', note: '' };
      return null;
    });
    const hit = (await Promise.all(attempts)).find(Boolean);
    if (request !== anipubPlayRequest || current !== owner) return;
    if (hit) {
      url = hit.url;
      effectiveLang = hit.lang;
      dubNote = hit.note;
    }

    // Fallback: AniPub's listing for this title (covers shows/episodes MegaPlay's MAL
    // mapping is missing). Resolved against a snapshot so a stale request cannot write
    // the previous season's AniPub ID into the current season.
    if (!url) {
      const lookupOwner = { ...owner };
      const id = await findAniPubAnime(lookupOwner);
      if (request !== anipubPlayRequest || current !== owner) return;
      owner.anipubId = id;
      if (!Array.isArray(owner.anipubEpisodes)) {
        const episodeUrls = await getAniPubEpisodeUrls(id);
        if (request !== anipubPlayRequest || current !== owner) return;
        owner.anipubEpisodes = episodeUrls;
      }
      const available = owner.anipubEpisodes.length;
      if (!available) throw new Error(`No playable source for Episode ${episode}.`);
      if (available > (owner.episodes || 0)) { owner.episodes = available; renderAnimeEps(); }
      const raw = owner.anipubEpisodes[Math.min(epIndex, available - 1)] || '';
      if (!raw) throw new Error(`No playable source for Episode ${episode}.`);
      const anipubFileId = anipubVideoId(raw);
      if (lang === 'dub' && anipubFileId && !(await probeAnipubDub(anipubFileId))) {
        effectiveLang = 'sub';
        dubNote = `No dub for Episode ${episode} yet.`;
      }
      if (request !== anipubPlayRequest || current !== owner) return;
      url = anipubPlayerSrc(raw, effectiveLang);
    }

    if (!url) throw new Error(`No playable source for Episode ${episode}.`);
    owner.effectiveLang = effectiveLang;
    renderAnimeLang(dubNote);

    $('mediaMeta').textContent = [
      owner.seasonYear,
      owner.averageScore ? `★ ${(owner.averageScore / 10).toFixed(1)}` : '',
      (owner.genres || []).slice(0, 3).join(', '),
      `${owner.episodes || 12} episodes`,
      `${effectiveLang === 'dub' ? 'DUB' : 'SUB'}`,
      dubNote
    ].filter(Boolean).join(' · ');
    playNow(url);
  } catch (error) {
    if (request !== anipubPlayRequest || current !== owner) return;
    const message = error?.message || 'Could not load a stream for this episode.';
    $('mediaMeta').textContent = message;
    // Clear the previous episode so an unavailable selection does not keep
    // showing stale playback from the last episode.
    setPlayerSrc('about:blank');
  }
}
function setLang(l) {
  lang = l;
  try { localStorage.setItem('animestream.lang', l); } catch (_) {}
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
      const name = item._title || item.title || 'This title';
      const when = airingLabel(item).toLowerCase() === 'coming soon' ? 'date not announced' : airingLabel(item).toLowerCase();
      flashNote(`${name} is not out yet \u2014 ${when}. Looking for earlier seasons\u2026`);
      latestReleasedSeason(Number(item.id || item.ani_id || item.aniId)).then(prev => {
        if (!prev) { flashNote(`${name} is not out yet \u2014 ${when}. Add it to My List and check back when it drops.`); return; }
        flashNote(`${name} isn\u2019t out yet \u2014 opening ${titleOf(prev)} so you can watch the earlier episodes.`);
        openAnime(prev.id, prev.idMal || 0, titleOf(prev), prev.episodes || 12);
      });
      return;
    }
    openAnime(item.id || item.ani_id || item.aniId, item.idMal || item.mal_id || item.malId || 0, item._title || item.title, item.episodes || 12);
  }
  else if(type==='movie') openMovie(item.tmdb || item.id, item.imdb || '', item._title || item.title);
  else if(type==='manga') readManga(item);
  else if(type==='comic') readComic(item);
  else openTv(item.imdb || '', String(item.tvmaze || item.id || ''), item._title || item.title);
}
