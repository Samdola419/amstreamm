/* ----------------------------------------------------------------------
   AnimeStream search overlay + result rendering
   Searches anime, movies and series only (manga & comics live on their own page).
   ---------------------------------------------------------------------- */
let searchFilter = 'all';
let searchData = { q: '', groups: null };
const SEARCH_LABELS = { all: 'titles', movie: 'movies', tv: 'series', anime: 'anime' };
const SEARCH_TYPES = ['anime', 'tv', 'movie'];
const RECENT_KEY = 'animestream.recent.searches';
const POPULAR_SEARCHES = ['One Piece', 'Naruto', 'Black Clover', 'Attack on Titan', 'Demon Slayer', 'Jujutsu Kaisen', 'Solo Leveling', 'Breaking Bad'];

function recentSearches() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 8) : []; }
  catch (_) { return []; }
}
function saveRecentSearch(q) {
  q = String(q || '').trim();
  if (q.length < 2) return;
  try {
    const list = recentSearches().filter(x => x.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch (_) {}
}
function clearRecentSearches() {
  try { localStorage.removeItem(RECENT_KEY); } catch (_) {}
  renderSearchIdle();
}
function removeRecentSearch(i) {
  try { const l = recentSearches(); l.splice(i, 1); localStorage.setItem(RECENT_KEY, JSON.stringify(l)); } catch (_) {}
  renderSearchIdle();
}
const escQ = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function renderSearchIdle() {
  searchData = { q: '', groups: null };
  $('searchHint').textContent = '';
  $('searchResults').innerHTML = '';
  const recent = recentSearches();
  let html = '';
  if (recent.length) {
    html += `<div class="search-idle-head"><span>Recent</span><button type="button" onclick="clearRecentSearches()">Clear all</button></div>
      <div class="search-chips">${recent.map((r, i) =>
        `<span class="search-chip recent"><button type="button" onclick="searchFor(this.dataset.q)" data-q="${escQ(r)}"><i class="ri-history-line" aria-hidden="true"></i>${escQ(r)}</button><button type="button" class="x" onclick="removeRecentSearch(${i})" aria-label="Remove ${escQ(r)}"><i class="ri-close-line" aria-hidden="true"></i></button></span>`).join('')}</div>`;
  }
  html += `<div class="search-idle-head"><span>Popular right now</span></div>
    <div class="search-chips">${POPULAR_SEARCHES.map(p =>
      `<span class="search-chip"><button type="button" onclick="searchFor(this.dataset.q)" data-q="${escQ(p)}"><i class="ri-fire-line" aria-hidden="true"></i>${escQ(p)}</button></span>`).join('')}</div>`;
  $('searchIdle').innerHTML = html;
  $('searchIdle').hidden = false;
  syncSearchClear();
}
function renderSearchSkeleton() {
  $('searchIdle').hidden = true;
  $('searchResults').innerHTML = Array.from({ length: 10 }, () => '<div class="search-skel"><div class="search-skel-poster"></div><div class="search-skel-line"></div></div>').join('');
}
function syncSearchClear() {
  const b = $('searchClear'); if (b) b.hidden = !$('searchInput').value;
}
function clearSearchInput() {
  $('searchInput').value = '';
  clearTimeout(searchTimer);
  renderSearchIdle();
  $('searchInput').focus();
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
  syncSearchClear();
  saveRecentSearch(q);
  runSearch(q);
  $('searchInput').focus();
}
$('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  syncSearchClear();
  const q = $('searchInput').value.trim();
  if (q.length < 2) { renderSearchIdle(); return; }
  $('searchHint').textContent = '';
  renderSearchSkeleton();
  searchTimer = setTimeout(() => runSearch(q), 180);
});
$('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSearch();
  if (e.key === 'Enter') {
    const q = $('searchInput').value.trim();
    if (q.length >= 2) { clearTimeout(searchTimer); saveRecentSearch(q); runSearch(q); $('searchInput').blur(); }
  }
});
// Remember a search when the viewer actually opens a result from it.
$('searchResults').addEventListener('click', () => saveRecentSearch($('searchInput').value));

function renderSearchResults() {
  const g = searchData.groups;
  if (!g) return;
  $('searchIdle').hidden = true;
  const types = searchFilter === 'all' ? SEARCH_TYPES.filter(t => TYPE_ENABLED[t]) : [searchFilter];
  const seen = new Set(), unique = [];
  for (const t of types) {
    for (const it of (g[t] || [])) {
      const k = (it._type || t) + ':' + (it._title || '').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); unique.push(it);
    }
  }
  const shown = unique.slice(0, 60);
  $('searchResults').innerHTML = shown.length ? shown.map(cardHTML).join('') : '<div class="state search-empty"><i class="ri-search-eye-line" aria-hidden="true"></i><b>No matches</b><span>Try a shorter title or another spelling.</span></div>';
  $('searchHint').textContent = shown.length ? `${shown.length} ${shown.length === 1 ? SEARCH_LABELS[searchFilter].replace(/s$/, '') : SEARCH_LABELS[searchFilter]} found` : '';
}
async function runSearch(q) {
  $('searchHint').textContent = '';
  if (!searchData.groups || searchData.q !== q) renderSearchSkeleton();
  const [anime, tv, movie] = await Promise.all([
    !TYPE_ENABLED.anime ? [] : anilist(Q_ANIME_SEARCH, { q }).then(d => (d.Page.media || []).map(mapAnime)).catch(() => []),
    !TYPE_ENABLED.tv ? [] : searchTvmaze(q).catch(() => []),
    !TYPE_ENABLED.movie ? [] : (async () => {
      const found = await fetchCinemetaMovies(`search=${encodeURIComponent(q)}`).catch(() => []);
      const ql = q.toLowerCase();
      const local = movieCache.filter(m => (m._title || '').toLowerCase().includes(ql));
      return [...found, ...local];
    })()
  ]);
  if ($('searchInput').value.trim() !== q) return;
  searchData = { q, groups: { anime, tv, movie } };
  renderSearchResults();
}
