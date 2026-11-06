/* ----------------------------------------------------------------------
   AnimeStream player server attempts, VAST ad engine, direct embed playback
   ---------------------------------------------------------------------- */
function showPlayer() { setNav(''); closeSearch(); showPage('playerView'); }
const VAST_TAG_URL = 'https://s.magsrv.com/v1/vast.php?idz=6051704';
const PLAYER_ADS = false; // true brings back the pre-roll / mid-roll pop-up before shows; the top banner ad plays either way
let vastPendingUrl = '';
let vastAdActive = false;
let vastSessionToken = 0;
let vastViewSeconds = 0;
let vastNextMidroll = randomMidrollSeconds();
let vastLastActivity = Date.now();
let vastAdTrackers = {};
let vastClickThrough = '';
function randomMidrollSeconds(){ return (20 + Math.random() * 5) * 60; }
function vastTrack(name){ (vastAdTrackers[name] || []).forEach(url => { try { const img = new Image(); img.src = url; } catch(_){} }); }
function vastText(node, selector){ return node.querySelector(selector)?.textContent?.trim() || ''; }
function vastResolveUrl(base, value){ try { return new URL(value, base).href; } catch(_) { return value; } }
async function fetchVastCreative(url, depth=0){
  if(depth>4) throw new Error('Too many VAST wrappers');
  const response=await fetch(url, {cache:'no-store', mode:'cors'});
  if(!response.ok) throw new Error('VAST request failed ('+response.status+')');
  const xmlText=await response.text();
  const doc=new DOMParser().parseFromString(xmlText,'application/xml');
  if(doc.querySelector('parsererror')) throw new Error('Invalid VAST XML');
  const wrapper=doc.querySelector('Wrapper');
  if(wrapper){
    const next=vastText(wrapper,'VASTAdTagURI');
    if(!next) throw new Error('VAST wrapper has no ad tag URI');
    const wrapperTrackers={};
    wrapper.querySelectorAll('Impression').forEach(n=>{const v=n.textContent.trim();if(v)(wrapperTrackers.impression ||= []).push(vastResolveUrl(url,v));});
    wrapper.querySelectorAll('Tracking').forEach(n=>{const ev=n.getAttribute('event');const v=n.textContent.trim();if(ev&&v)(wrapperTrackers[ev] ||= []).push(vastResolveUrl(url,v));});
    const creative=await fetchVastCreative(vastResolveUrl(url,next),depth+1);
    Object.keys(wrapperTrackers).forEach(k=>{creative.trackers[k]=[...(creative.trackers[k]||[]),...wrapperTrackers[k]];});
    return creative;
  }
  const linear=doc.querySelector('Linear');
  if(!linear) throw new Error('VAST contains no linear video ad');
  const media=[...linear.querySelectorAll('MediaFile')].map(n=>({url:n.textContent.trim(),type:n.getAttribute('type')||'',delivery:n.getAttribute('delivery')||''})).filter(m=>m.url && (!m.type || m.type.startsWith('video/'))).sort((a,b)=>Number(b.type.includes('mp4'))-Number(a.type.includes('mp4')));
  if(!media.length) throw new Error('VAST has no compatible video media file');
  const trackers={};
  doc.querySelectorAll('Impression').forEach(n=>{const v=n.textContent.trim();if(v)(trackers.impression ||= []).push(vastResolveUrl(url,v));});
  linear.querySelectorAll('Tracking').forEach(n=>{const ev=n.getAttribute('event');const v=n.textContent.trim();if(ev&&v)(trackers[ev] ||= []).push(vastResolveUrl(url,v));});
  const click=vastText(linear,'VideoClicks ClickThrough') || vastText(doc,'VideoClicks ClickThrough');
  return {media:media[0],trackers,click:click?vastResolveUrl(url,click):'',duration:vastText(linear,'Duration')};
}
function vastParseDuration(value){const m=(value||'').match(/^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d+))?$/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):0;}
let vastCurrentReason = 'preroll';
function vastFinishAd(){
  if(!vastAdActive)return;
  vastAdActive=false;
  const video=$('vastAdVideo'); try{video.pause();}catch(_){}
  video.removeAttribute('src'); video.load();
  $('vastAdOverlay').classList.remove('is-visible');
  $('vastAdClick').classList.remove('is-active'); $('vastAdClick').removeAttribute('href');
  // Pre-roll stream is already loaded behind the overlay; do not restart its navigation.
  // Mid-roll keeps its previous pause/resume behavior.
  if(vastCurrentReason === 'midroll' && vastPendingUrl) setPlayerSrc(vastPendingUrl);
  vastViewSeconds=0; vastNextMidroll=randomMidrollSeconds();
  vastLastActivity=Date.now();
}
async function runVastAd(reason){
  if(!PLAYER_ADS) return; // no overlay ads on the watch page
  if(vastAdActive || !vastPendingUrl)return;
  const token=++vastSessionToken; vastAdActive=true; vastCurrentReason=reason;
  const overlay=$('vastAdOverlay'), video=$('vastAdVideo'), close=$('vastAdClose');
  // During pre-roll the stream must keep loading behind the ad. Mid-roll temporarily
  // blanks it to avoid continuing audio beneath the ad, matching the existing behavior.
  if(reason === 'midroll') setPlayerSrc('about:blank');
  overlay.classList.add('is-visible'); $('vastAdLabel').textContent=reason==='preroll'?'Advertisement · Before your show':'Advertisement · Mid-roll';
  $('vastAdStatus').textContent='Loading advertisement…'; close.disabled=true; close.textContent='Ad playing';
  try{
    const ad=await fetchVastCreative(VAST_TAG_URL + (VAST_TAG_URL.includes('?')?'&':'?')+'cb='+Date.now());
    if(token!==vastSessionToken)return;
    vastAdTrackers=ad.trackers||{}; vastClickThrough=ad.click||'';
    $('vastAdClick').href=vastClickThrough||'#'; $('vastAdClick').classList.toggle('is-active',!!vastClickThrough);
    video.src=vastResolveUrl(VAST_TAG_URL,ad.media.url);
    video.currentTime=0; video.muted=false;
    $('vastAdStatus').textContent='The show resumes when the ad finishes.';
    video.onplaying=()=>vastTrack('start');
    video.ontimeupdate=()=>{const d=video.duration;if(d>0){if(video.currentTime>=d*.25)vastTrackOnce('firstQuartile');if(video.currentTime>=d*.5)vastTrackOnce('midpoint');if(video.currentTime>=d*.75)vastTrackOnce('thirdQuartile');}};
    video.onended=()=>{vastTrack('complete');vastFinishAd();};
    video.onerror=()=>vastFinishAd();
    await video.play();
    vastTrack('impression');
  }catch(err){
    if(token!==vastSessionToken)return;
    console.warn('VAST ad could not play; continuing to the show:',err);
    $('vastAdStatus').textContent='Advertisement unavailable. Continuing to the show…';
    vastFinishAd();
  }
}
let vastTrackedEvents=new Set();
function vastTrackOnce(name){if(vastTrackedEvents.has(name))return;vastTrackedEvents.add(name);vastTrack(name);}
let playbackQueue = [], playbackQueueIndex = 0, playbackToken = 0, playbackTimer = null, playbackCurrentUrl = '', expectedPlayerSrc = '';
function normalizeStreamUrl(url) { return String(url || '').replace(/^http:\/\//i, 'https://'); }
function getCurrentServerAttempts(firstUrl) {
  const entries = [];
  if (current?.type === 'movie') {
    // Only the server the viewer is on: no automatic hopping to other servers.
    entries.push({index: serverIdx, url: (MOVIE_SERVERS[serverIdx] || MOVIE_SERVERS[0]).url(current)});
  } else if (current?.type === 'tv') {
    const list = current.seasons?.[season] || [];
    const episode = list[epIndex]?.number || epIndex + 1;
    const id = current.tmdb || current.imdb || current.id;
    if (id) entries.push({index: serverIdx, url: (TV_SERVERS[serverIdx] || TV_SERVERS[0]).url(id, season, episode)});
  } else if (current?.type === 'anime') {
    // MegaPlay's MAL catalogue plays the episode directly in the chosen language.
    const episode = epIndex + 1;
    const wanted = current.effectiveLang === 'dub' || current.effectiveLang === 'sub' ? current.effectiveLang : lang;
    for (let step = 0; step < ANIME_SERVERS.length; step++) {
      const i = (serverIdx + step) % ANIME_SERVERS.length;
      const url = ANIME_SERVERS[i].url(current, episode, wanted);
      if (url) entries.push({ index: i, url: normalizeStreamUrl(url) });
    }
  }
  const normalizedFirst = normalizeStreamUrl(firstUrl);
  const startIndex = Math.max(0, entries.findIndex(e => normalizeStreamUrl(e.url) === normalizedFirst));
  const ordered = [{ index: entries[startIndex]?.index ?? serverIdx, url: normalizedFirst }];
  for (let step = 1; step <= entries.length; step++) {
    const entry = entries[(startIndex + step) % entries.length];
    if (!entry?.url) continue;
    const normalized = normalizeStreamUrl(entry.url);
    if (normalized && !ordered.some(x => x.url === normalized)) ordered.push({ index: entry.index, url: normalized });
  }
  return ordered;
}
function updateActiveServer(index) {
  if (!Number.isInteger(index)) return;
  serverIdx = index;
  document.querySelectorAll('.server-btn').forEach((el, idx) => el.classList.toggle('active', idx === index));
}
function tryPlaybackAttempt(token) {
  if (token !== playbackToken || !playbackQueue.length) return;
  clearTimeout(playbackTimer);
  if (playbackQueueIndex >= playbackQueue.length) {
    const meta = $('mediaMeta');
    if (meta && !meta.textContent.includes('Try again')) meta.textContent += ' · Could not load this stream. Try again.';
    return;
  }
  const attempt = playbackQueue[playbackQueueIndex];
  playbackCurrentUrl = attempt.url;
  vastPendingUrl = attempt.url;
  updateActiveServer(attempt.index);
  setPlayerSrc(attempt.url);
  // AniPub returns a direct embed iframe; no provider-specific proxy watchdog is used.
  // Cross-origin embeds don't expose playable/error state, so only retry when navigation itself stalls.
  playbackTimer = setTimeout(() => {
    if (token !== playbackToken || playbackCurrentUrl !== attempt.url) return;
    playbackQueueIndex++;
    if (playbackQueueIndex < playbackQueue.length) tryPlaybackAttempt(token);
    else {
      const meta = $('mediaMeta');
      if (meta && !meta.textContent.includes('Try again')) meta.textContent += (current?.type === 'anime' ? ' · This episode is taking longer than expected. Try again.' : ' · This stream is taking longer than expected. Try again.');
    }
  }, 9000);
}
function onPlayerLoad() {
  const el = $('player');
  if (!el || !playbackCurrentUrl) return;
  let same = false;
  try {
    const expected = new URL(expectedPlayerSrc || playbackCurrentUrl, location.href).href;
    same = el.src === expected || el.src === new URL(playbackCurrentUrl, location.href).href;
  } catch (_) { same = false; }
  if (!same) return;
  clearTimeout(playbackTimer);
}
$('player')?.addEventListener('load', onPlayerLoad);
// Changing an iframe's src adds an entry to the browser history, so Back needed two taps on the player page.
// A fresh iframe that gets its src before it is inserted loads as a replacement, so Back only sees the app's own pages.
// ---- Next episode + auto-next ----
// The video lives in another site's page, so the only way to know an episode ended is if that player tells us (postMessage).
// Some embedded players send completion/time messages; otherwise the Next button is the way to continue.
let autoNext = true;
try { autoNext = localStorage.getItem('animestream.autonext') !== '0'; } catch (_) {}
let nextUpTimer = null, nextUpShownFor = '';
function nextEpisodeTarget() {
  if (!current) return null;
  if (current.type === 'tv') {
    const list = current.seasons?.[season] || [];
    if (epIndex + 1 < list.length) return { label: 'Episode ' + (list[epIndex + 1].number || epIndex + 2), go: () => playTv(epIndex + 1) };
    const sl = current.seasonList || [], si = sl.indexOf(season);
    if (si >= 0 && si + 1 < sl.length) return { label: 'Season ' + sl[si + 1] + ', Episode 1', go: () => setSeason(sl[si + 1]) };
    return null;
  }
  if (current.type === 'anime') {
    if (epIndex + 1 < (current.episodes || 0)) return { label: 'Episode ' + (epIndex + 2), go: () => playAnime(epIndex + 1) };
    if (current.seasons && current.seasonIdx + 1 < current.seasons.length) return { label: 'Season ' + (current.seasonIdx + 2), go: () => setAnimeSeason(current.seasonIdx + 1) };
  }
  return null;
}
function syncNextUI() {
  const has = !!nextEpisodeTarget(), nb = $('nextBtn'), ab = $('autoNextToggle');
  if (nb) nb.style.display = has ? '' : 'none';
  if (ab) { ab.style.display = current && current.type !== 'movie' ? '' : 'none'; ab.textContent = 'Auto-next: ' + (autoNext ? 'On' : 'Off'); ab.classList.toggle('active', autoNext); ab.setAttribute('aria-pressed', String(autoNext)); }
}
function toggleAutoNext() {
  autoNext = !autoNext;
  try { localStorage.setItem('animestream.autonext', autoNext ? '1' : '0'); } catch (_) {}
  if (!autoNext) hideNextUp();
  syncNextUI();
}
function hideNextUp() {
  clearInterval(nextUpTimer); nextUpTimer = null;
  $('nextUp')?.classList.add('hidden');
}
function goNextEpisode() {
  const t = nextEpisodeTarget();
  hideNextUp();
  if (t) t.go();
}
function showNextUp(countdown) {
  const t = nextEpisodeTarget(), card = $('nextUp');
  if (!t || !card) return;
  clearInterval(nextUpTimer);
  $('nextUpLabel').textContent = t.label;
  const bar = $('nextUpBar');
  bar.style.transition = 'none'; bar.style.width = '0';
  card.classList.remove('hidden');
  if (!countdown) { $('nextUpPlay').textContent = 'Play now'; return; }
  let left = countdown;
  $('nextUpPlay').textContent = 'Play now (' + left + ')';
  void bar.offsetWidth; bar.style.transition = 'width ' + countdown + 's linear'; bar.style.width = '100%';
  nextUpTimer = setInterval(() => {
    left--;
    if (left <= 0) { goNextEpisode(); return; }
    $('nextUpPlay').textContent = 'Play now (' + left + ')';
  }, 1000);
}
function parsePlayerMessage(raw) {
  let d = raw;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { return null; } }
  if (!d || typeof d !== 'object') return null;
  const inner = (d.data && typeof d.data === 'object') ? d.data : (d.value && typeof d.value === 'object') ? d.value : d;
  const ev = String(d.event || inner.event || d.type || '').toLowerCase();
  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  if (['complete', 'completed', 'ended', 'end', 'finish', 'finished'].includes(ev)) return { kind: 'complete' };
  if (['time', 'timeupdate', 'progress'].includes(ev) || d.type === 'watching-log') {
    const time = num(inner.time ?? inner.currentTime ?? inner.seconds), duration = num(inner.duration);
    if (duration > 0) return { kind: 'time', time, duration };
  }
  return null;
}
window.addEventListener('message', e => {
  const frame = $('player');
  if (!frame || e.source !== frame.contentWindow || vastAdActive) return; // only the video frame, never while the ad plays
  // MegaPlay shim reports an unusable stream page. In dub mode, mark that episode's dub
  // as missing and continue in SUB instead of leaving the viewer on a broken player.
  if (e.data && e.data.type === 'mp-miss' && current?.type === 'anime') {
    if (lang === 'dub') {
      const mal = Number(current.mal_id) || 0;
      if (mal) writeMegaProbe(`m:${mal}:${epIndex + 1}:dub`, false);
      const ani = Number(current.ani_id) || 0;
      if (ani) writeMegaProbe(`i:${ani}:${epIndex + 1}:dub`, false);
      const raw = Array.isArray(current.anipubEpisodes) ? current.anipubEpisodes[epIndex] : '';
      const videoId = anipubVideoId(raw);
      if (videoId) writeMegaProbe(`a:${videoId}:dub`, false);
      current.dubRetried = epIndex; // prevent a retry loop on this episode
      setLang('sub');
      showResumeNote('Dub not available for this episode — switched to SUB.');
      return;
    }
  }
  const m = parsePlayerMessage(e.data);
  if (!m) return;
  // Watch-position memory for movies & series: keep the resume point even when
  // auto-next is off, so Continue Watching and the card badge stay truthful.
  if (m.kind === 'time' && current && current.type === 'movie') {
    if (Date.now() - watchPulse.at > 15000) { // store at most every ~15s
      watchPulse.at = Date.now();
      saveProgress({ p: m.time, dur: m.duration });
    }
  }
  if (!autoNext || !nextEpisodeTarget()) return;
  const key = currentKey() + ':' + season + ':' + epIndex;
  if (m.kind === 'complete') { nextUpShownFor = key; showNextUp(6); }
  else if (m.duration > 120 && m.duration - m.time <= 20 && nextUpShownFor !== key) { nextUpShownFor = key; showNextUp(0); } // heads-up card near the end
});

// Movie and series embeds ride the sandboxed generic shield (vidsrc.pm): the sandbox
// blocks its pop-under tags, so the site can never be redirected. Anime embeds go
// through the same shim with the partner-token referrer (unsandboxed for MegaPlay).
function setPlayerSrc(url) {
  const old = $('player');
  if (!old) return;
  if (/^https?:\/\//i.test(String(url)) && current && (current.type === 'movie' || current.type === 'tv')
      && String(url).indexOf('/megaplay.html?') !== 0) {
    url = '/megaplay.html?src=' + encodeURIComponent(url) + '&sv=2';
  }
  expectedPlayerSrc = url;
  hideNextUp(); nextUpShownFor = ''; syncNextUI();
  const fresh = old.cloneNode(false);
  fresh.removeAttribute('src');
  if (url) fresh.setAttribute('src', url);
  fresh.addEventListener('load', onPlayerLoad);
  old.replaceWith(fresh);
}
function playNow(url) {
  if (!url) return;
  playbackToken++;
  clearTimeout(playbackTimer);
  playbackQueue = getCurrentServerAttempts(url);
  playbackQueueIndex = 0;
  if (!playbackQueue.length) playbackQueue = [{ index: serverIdx, url: normalizeStreamUrl(url) }];
  vastPendingUrl = normalizeStreamUrl(url);
  vastTrackedEvents = new Set();
  if (vastAdActive) { vastSessionToken++; try{$('vastAdVideo').pause();}catch(_){} vastAdActive=false; $('vastAdOverlay').classList.remove('is-visible'); }
  // Start loading the chosen stream immediately; the pre-roll overlay sits above the iframe.
  tryPlaybackAttempt(playbackToken);
  if (PLAYER_ADS) runVastAd('preroll');
}
// Count only active time while the player page is visible and the viewer has interacted recently.
['pointerdown','keydown','touchstart','mousemove'].forEach(evt=>document.addEventListener(evt,()=>{vastLastActivity=Date.now();},{passive:true}));
setInterval(()=>{
  if(!PLAYER_ADS || vastAdActive || !vastPendingUrl || document.hidden || !$('playerView') || $('playerView').classList.contains('hidden-page'))return;
  vastViewSeconds++;
  if(vastViewSeconds>=vastNextMidroll)runVastAd('midroll');
},1000);
$('vastAdVideo')?.addEventListener('click',()=>{if(vastClickThrough)window.open(vastClickThrough,'_blank','noopener');});
$('vastAdClose')?.addEventListener('click',()=>{if(!$('vastAdClose').disabled)vastFinishAd();});


// ---- Top banner ad: plays automatically (muted) at the top of the home page, one ad after another ----
let bannerToken = 0, bannerRetry = 0;
const watchPulse = { at: 0 }; // movie watch-position pulse timer (player messages)
async function loadBannerAd() {
  const v = $('adBannerVideo'), box = $('adBanner');
  if (!v || !box) return;
  const token = ++bannerToken;
  try {
    const ad = await fetchVastCreative(VAST_TAG_URL + (VAST_TAG_URL.includes('?') ? '&' : '?') + 'cb=' + Date.now());
    if (token !== bannerToken) return;
    vastAdTrackers = ad.trackers || {}; vastTrackedEvents = new Set();
    const link = $('adBannerLink');
    if (ad.click) { link.href = ad.click; link.classList.add('on'); } else { link.removeAttribute('href'); link.classList.remove('on'); }
    v.muted = true; v.defaultMuted = true; v.playsInline = true;
    v.onplaying = () => { vastTrackOnce('start'); box.classList.add('ready'); };
    v.ontimeupdate = () => { const d = v.duration; if (d > 0) { if (v.currentTime >= d * .25) vastTrackOnce('firstQuartile'); if (v.currentTime >= d * .5) vastTrackOnce('midpoint'); if (v.currentTime >= d * .75) vastTrackOnce('thirdQuartile'); } };
    v.onended = () => { vastTrack('complete'); box.classList.remove('ready'); loadBannerAd(); };
    v.onerror = () => { box.classList.remove('ready'); box.classList.add('ad-wait'); clearTimeout(bannerRetry); bannerRetry = setTimeout(loadBannerAd, 9000); };
    v.src = vastResolveUrl(VAST_TAG_URL, ad.media.url);
    await v.play();
    vastTrack('impression');
  } catch (e) {
    if (token !== bannerToken) return;
    box.classList.remove('ready');
    box.classList.add('ad-wait'); // keep the sponsored strip visible with a subtle "loading" state
    clearTimeout(bannerRetry); bannerRetry = setTimeout(loadBannerAd, 9000); // keep trying for the video ad
  }
}
const AD_PAGES = ['homeView', 'browseView', 'myListView', 'continueView', 'mangaView'];
function syncBannerAd(screenId) {
  const box = $('adBanner'), v = $('adBannerVideo'); if (!box || !v) return;
  if (AD_PAGES.includes(screenId)) {
    const page = $(screenId);
    if (page && box.parentNode !== page) { page.insertBefore(box, page.firstChild); }
    box.classList.toggle('ad-offset', screenId !== 'homeView');
    box.classList.remove('ad-off');
    if (v.src) v.play().catch(() => {});
    else { clearTimeout(bannerRetry); loadBannerAd(); }
  } else {
    box.classList.add('ad-off');
    try { v.pause(); } catch (_) {}
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncBannerAd(currentScreenId); });
$('adBannerLink')?.addEventListener('click', () => vastTrack('click'));

// ---- Episodes button + YouTube-style "more to watch" panel ----
function setEpisodeMode(has) {
  const btn = $('epToggle'), panel = $('epPanel');
  if (btn) { btn.style.display = has ? '' : 'none'; btn.classList.remove('active'); btn.setAttribute('aria-expanded', 'false'); }
  if (panel) panel.classList.remove('open');
}
function toggleEpisodes() {
  const panel = $('epPanel'), btn = $('epToggle');
  if (!panel || !btn) return;
  const open = panel.classList.toggle('open');
  btn.classList.toggle('active', open);
  btn.setAttribute('aria-expanded', String(open));
  if (open) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
let upNextTab = 'related', upNextToken = 0;
function currentKey() {
  if (!current) return '';
  const id = current.type === 'anime' ? current.ani_id : current.type === 'movie' ? (current.imdb || current.tmdb || current.id) : (current.tvmaze || current.id);
  return `${current.type}:${id}`.toLowerCase();
}
function currentGenres() {
  const pick = x => Array.isArray(x?.genres) && x.genres.length ? x.genres : Array.isArray(x?._genres) ? x._genres : [];
  let g = pick(current); if (g.length) return g;
  g = pick(current?.sourceItem); if (g.length) return g;
  if (activeDetail && (activeDetail._title === current?.title || activeDetail.title === current?.title)) { g = pick(activeDetail); if (g.length) return g; }
  return [];
}
function catalogPool() {
  const lists = [...Array.from(mediaRegistry.values()), ...Object.values(homeCollections).flat(), ...seriesCache, ...movieCache];
  const seen = new Set([currentKey()]), out = [];
  for (const it of lists) {
    if (!it) continue;
    const k = mediaKey(it);
    if (seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
}
const upRating = m => Number(m.averageScore ? m.averageScore / 10 : ((String(m._sub || '').match(/★\s*([\d.]+)/) || [])[1] || m.rating?.average || 0));
async function upNextItems(tab, genres) {
  const type = current.type, self = currentKey(), pool = catalogPool();
  const typeOf = it => it._type || it.type || 'anime';
  const gset = new Set(genres.map(g => String(g).toLowerCase()));
  const overlap = it => (it.genres || it._genres || []).filter(x => gset.has(String(x).toLowerCase())).length;
  const dedupe = list => { const seen = new Set([self]); return list.filter(it => { if (!it) return false; const k = mediaKey(it); if (seen.has(k)) return false; seen.add(k); return true; }); };
  if (tab === 'related') return dedupe(pool.filter(it => typeOf(it) === type).sort((a, b) => overlap(b) - overlap(a)));
  if (tab === 'recommended') {
    if (type === 'anime' && current.ani_id) {
      const d = await anilist(Q_ANIME_RECS, { id: Number(current.ani_id) }).catch(() => null);
      const recs = (d?.Media?.recommendations?.nodes || []).map(n => n.mediaRecommendation).filter(Boolean).map(mapAnime);
      if (recs.length) return dedupe(recs);
    }
    return dedupe([...pool].sort(() => Math.random() - .5));
  }
  if (tab === 'trending') {
    const src = [homeCollections.animeTrend, homeCollections.moviesPop, homeCollections.series].map(l => l || []);
    const out = [];
    for (let i = 0; i < 8; i++) src.forEach(l => { if (l[i]) out.push(l[i]); });
    return dedupe(out);
  }
  if (tab === 'genre') {
    const g = genres[0];
    if (type === 'anime') { const d = await anilist(Q_ANIME_GENRE, { page: 1, genre: g }); return dedupe((d.Page.media || []).map(mapAnime)); }
    if (type === 'movie') return dedupe(await fetchCinemetaMovies('genre=' + encodeURIComponent(g)));
    const shows = seriesCache.length ? seriesCache : await fetchTvmazePopular();
    return dedupe(shows.filter(s => (s.genres || []).some(x => String(x).toLowerCase() === String(g).toLowerCase())));
  }
  return dedupe([...pool].sort((a, b) => upRating(b) - upRating(a)));
}
function upNextItemHTML(item) {
  const type = item._type || item.type || 'anime', title = item._title || item.title || 'Untitled';
  const posters = posterCandidates(item), key = registerMedia(item), letter = (title[0] || '?').toUpperCase();
  const img = posters.length
    ? `<img src="${escAttr(posters[0])}" data-poster-fallback="${escAttr(JSON.stringify(posters.slice(1)))}" alt="" loading="lazy" decoding="async" onerror="handlePosterError(this)"><div class="card-ph" style="display:none">${escHtml(letter)}</div>`
    : `<div class="card-ph">${escHtml(letter)}</div>`;
  const meta = [type === 'tv' ? 'Series' : type === 'movie' ? 'Movie' : 'Anime', item._sub].filter(Boolean).join(' · ');
  return `<button type="button" class="up-item" onclick="openDetailsByKey('${key}')"><span class="up-thumb">${img}</span><span class="up-text"><span class="up-title">${escHtml(title)}</span><span class="up-meta">${escHtml(meta)}</span></span></button>`;
}
async function loadUpNext(tab) {
  if (!current) return;
  const owner = current, token = ++upNextToken, genres = currentGenres();
  upNextTab = tab || upNextTab;
  if (upNextTab === 'genre' && !genres.length) upNextTab = 'related';
  const defs = [['related', 'Related'], ['recommended', 'For you'], ['trending', 'Trending'], ...(genres.length ? [['genre', 'More ' + genres[0]]] : []), ['top', 'Top rated']];
  $('upNextTabs').innerHTML = defs.map(([k, l]) => `<button type="button" class="up-tab ${k === upNextTab ? 'active' : ''}" onclick="loadUpNext('${k}')">${escHtml(l)}</button>`).join('');
  $('upNextList').innerHTML = '<div class="state">Loading…</div>';
  let items = [];
  try { items = await upNextItems(upNextTab, genres); } catch (e) { items = []; }
  if (token !== upNextToken || current !== owner) return;
  items = items.slice(0, 14);
  $('upNextList').innerHTML = items.length ? items.map(upNextItemHTML).join('') : '<div class="state">Nothing here yet. Try another tab.</div>';
}

let resumeNoteTimer = null;
function showResumeNote(text) {
  let el = $('resumeNote');
  if (!el) {
    el = document.createElement('div'); el.id = 'resumeNote'; el.className = 'resume-note'; el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text; el.classList.add('show');
  clearTimeout(resumeNoteTimer);
  resumeNoteTimer = setTimeout(() => el.classList.remove('show'), 4000);
}
function renderServers(list) {
  if (!list || list.length < 2) {
    $('serverLabel').style.display = 'none';
    $('serverRow').innerHTML = '';
    return;
  }
  $('serverLabel').style.display = 'block';
  $('serverRow').innerHTML = list.map((s, i) =>
    `<button class="server-btn ${i === serverIdx ? 'active' : ''}" onclick="setServer(${i})" title="Switch server">Server ${i + 1}</button>`
  ).join('');
}
function setServer(i) {
  serverIdx = i;
  document.querySelectorAll('.server-btn').forEach((el, idx) => el.classList.toggle('active', idx === i));
  if (!current) return;
  if (current.type === 'movie') loadMovieServer();
  else if (current.type === 'tv') loadTvServer();
  else if (current.type === 'anime') playAnime(epIndex);
}
