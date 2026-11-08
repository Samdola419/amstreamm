/* ----------------------------------------------------------------------
   AnimeStream title screen + sharing
   ---------------------------------------------------------------------- */
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
  const saved=isSaved(m); $('detailSave').classList.toggle('saved',saved); $('detailSave').innerHTML=saved?'<i class="ri-check-line" aria-hidden="true"></i> In My List':'<i class="ri-bookmark-line" aria-hidden="true"></i> My List';
  if(!isSaveableType(m._type)) { // manga/comics are not saved to My List
    $('detailSave').classList.remove('saved');
    $('detailSave').innerHTML='<i class="ri-bookmark-line" aria-hidden="true"></i> Not saveable';
    $('detailSave').disabled=true; $('detailSave').onclick=null;
  } else { $('detailSave').disabled=false; }
  $('detailPlay').innerHTML = (m._type==='manga'||m._type==='comic') ? '<i class="ri-book-open-line" aria-hidden="true"></i> Read' : '<i class="ri-play-fill" aria-hidden="true"></i> Play';
  const resumeLbl = progressLabel(m);
  if (resumeLbl) $('detailPlay').innerHTML = `<i class="ri-play-fill" aria-hidden="true"></i> Resume ${escHtml(resumeLbl)}`;
  $('detailPlay').onclick=()=>playItem(m);
  renderMangaChapters(m);
  $('detailSave').onclick=()=>toggleSaved(m);
  $('detailShare').onclick=()=>shareTitle(m);
  // Related: instant row from loaded items, then upgraded to true related data
  // (AniList recommendations for anime, TVmaze recommended for series).
  // Unreleased titles never appear here.
  const dKey = mediaKey(m);
  const dType = m._type || m.type || 'anime';
  const cachedRelated = Array.from(mediaRegistry.values())
    .filter(x => mediaKey(x) !== dKey && (x._title || x.title) !== title && (x._type || x.type) === dType
                 && !(!x.episodes && x.nextAiringEpisode) && x.status !== 'NOT_YET_RELEASED')
    .slice(0, 12);
  $('detailRelated').innerHTML = cachedRelated.length ? rowHTML('<em>Related</em>', cachedRelated, null, 'detailRelatedRow') : '';
  fetchRelated(m).then(list => {
    list = list.filter(x => x && x.status !== 'NOT_YET_RELEASED' && !(!x.episodes && x.nextAiringEpisode));
    if (!list.length || !activeDetail || mediaKey(activeDetail) !== dKey || currentScreenId !== 'detailView') return;
    $('detailRelated').innerHTML = rowHTML('<em>Related</em>', list.slice(0, 24), null, 'detailRelatedRow');
  }).catch(() => {});
  if(m._type==='anime' && m.id){
    const key=mediaKey(m);
    anilist(Q_ANIME_INFO,{id:m.id}).then(d=>{
      if(!activeDetail || mediaKey(activeDetail)!==key) return;
      const media=d?.Media;
      if (media?.status) activeDetail.status = media.status;
      if (media?.nextAiringEpisode) activeDetail.nextAiringEpisode = media.nextAiringEpisode;
      const n=media?.episodes;
      $('detailMeta').insertAdjacentHTML('beforeend',`<span>${n?n+' episodes':'Ongoing'}</span>`);
      $('detailFacts').insertAdjacentHTML('afterbegin',`<span class="detail-fact"><b>Episodes</b> · ${n||'Ongoing'}</span>`);
      if (media?.status === 'NOT_YET_RELEASED') {
        $('detailPlay').innerHTML = '<i class="ri-calendar-schedule-line" aria-hidden="true"></i> Not out yet';
        // Play always routes through playItem, which opens the latest aired season if one exists.
        $('detailPlay').onclick = () => playItem(activeDetail);
        latestReleasedSeason(Number(m.id)).then(prev => {
          if (!prev || !activeDetail || mediaKey(activeDetail) !== key) return;
          $('detailPlay').innerHTML = '<i class="ri-play-fill" aria-hidden="true"></i> Watch earlier seasons';
        }).catch(() => {});
        return;
      }
    }).catch(()=>{});
  }
  showPage('detailView');
}
// True related titles: AniList recommendations for anime, TVmaze recommended for series.
// Movies keep the instant catalog fallback above.
async function fetchRelated(m) {
  const type = m._type || m.type || 'anime';
  try {
    if (type === 'anime' && m.id) {
      const d = await anilist(Q_ANIME_RELATED, { id: Number(m.id) });
      return (d?.Media?.recommendations?.nodes || [])
        .map(n => n && n.mediaRecommendation)
        .filter(Boolean)
        .filter(x => !x.isAdult)
        .map(mapAnime);
    }
    if (type === 'tv' && m.tvmaze && String(m.tvmaze).match(/^\d+$/)) {
      const res = await fetch(TVMAZE + '/shows/' + m.tvmaze + '/recommended');
      if (!res.ok) return [];
      const shows = await res.json();
      return (shows || []).slice(0, 24).map(mapTvmaze);
    }
  } catch (_) { return []; }
  return [];
}
// ---- Sharing: poster image + a link that reopens this exact title ----
function shareLink(m) {
  const home = location.origin + location.pathname, base = location.origin + '/api/share';
  const type = m._type || 'anime';
  const id = type === 'anime' ? (m.id || m.ani_id) : type === 'movie' ? m.imdb : (m.tvmaze || m.id);
  if (!id || (type === 'movie' && !String(id).startsWith('tt'))) return home;
  const u = new URL(base);
  u.searchParams.set('t', type); u.searchParams.set('id', String(id));
  return u.toString();
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

