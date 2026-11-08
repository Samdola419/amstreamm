/* ----------------------------------------------------------------------
   AnimeStream manga/comics reader + My List + Continue Watching
   ---------------------------------------------------------------------- */
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
    all:   ['Your list starts here', 'Open any anime, movie, series, manga or comic and add it to My List. Your picks stay saved on this device.', 'Explore anime', "nav('anime')"],
    anime: ['No anime saved yet', 'Open any anime and tap My List to keep it here.', 'Explore anime', "nav('anime')"],
    tv:    ['No series saved yet', 'Open any series and tap My List to keep it here.', 'Explore series', "nav('series')"],
    movie: ['No movies saved yet', 'Open any movie and tap My List to keep it here.', 'Explore movies', "nav('movies')"],
    manga: ['No manga saved yet', 'Open any manga and tap My List to keep it here.', 'Explore manga', "nav('manga')"],
    comic: ['No comics saved yet', 'Open any comic and tap My List to keep it here.', 'Explore comics', "nav('manga','comic')"]
  }[filter] || ['Your list starts here', 'Add titles to My List and they stay saved on this device.', 'Explore anime', "nav('anime')"];
  return `<div class="empty-collection"><span class="empty-icon"><i class="ri-bookmark-line" aria-hidden="true"></i></span><h2>${copy[0]}</h2><p>${copy[1]}</p><button onclick="${copy[3]}">${copy[2]}</button></div>`;
}
function renderMyList() {
  const all=animeOnly(getSavedList()); // My List shows anime, movies and series
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
  const list = getContinueList(); // continue watching now tracks anime, movies and series
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

