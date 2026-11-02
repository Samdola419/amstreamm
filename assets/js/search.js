/* ----------------------------------------------------------------------
   AnimeStream search overlay + result rendering
   ---------------------------------------------------------------------- */
let searchFilter = 'all';
let searchData = { q: '', groups: null };
const SEARCH_LABELS = { all: 'titles', movie: 'movies', tv: 'series', anime: 'anime', manga: 'manga', comic: 'comics' };
function renderSearchIdle() {
  searchData = { q: '', groups: null };
  $('searchHint').textContent = '';
  $('searchResults').innerHTML = '';
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
  runSearch(q);
  $('searchInput').focus();
}
$('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('searchInput').value.trim();
  if (q.length < 2) { renderSearchIdle(); return; }
  $('searchHint').textContent = 'Searching...';
  searchTimer = setTimeout(() => runSearch(q), 180);
});
$('searchInput').addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch(); });

function renderSearchResults() {
  const g = searchData.groups;
  if (!g) return;
  const types = searchFilter === 'all' ? ['anime', 'tv', 'movie', 'manga', 'comic'].filter(t => TYPE_ENABLED[t]) : [searchFilter];
  const seen = new Set(), unique = [];
  for (const t of types) {
    for (const it of (g[t] || [])) {
      const k = (it._type || t) + ':' + (it._title || '').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); unique.push(it);
    }
  }
  const shown = unique.slice(0, 60);
  $('searchResults').innerHTML = shown.length ? shown.map(cardHTML).join('') : '<div class="state">No matches. Try a shorter title or another spelling.</div>';
  $('searchHint').textContent = shown.length ? `${shown.length} ${shown.length === 1 ? SEARCH_LABELS[searchFilter].replace(/s$/, '') : SEARCH_LABELS[searchFilter]} found` : '';
}
async function runSearch(q) {
  $('searchHint').textContent = 'Searching...';
  const [anime, tv, movie, manga, comic] = await Promise.all([
    !TYPE_ENABLED.anime ? [] : anilist(Q_ANIME_SEARCH, { q }).then(d => (d.Page.media || []).map(mapAnime)).catch(() => []),
    !TYPE_ENABLED.tv ? [] : searchTvmaze(q).catch(() => []),
    !TYPE_ENABLED.movie ? [] : (async () => {
      const found = await fetchCinemetaMovies(`search=${encodeURIComponent(q)}`).catch(() => []);
      const ql = q.toLowerCase();
      const local = movieCache.filter(m => (m._title || '').toLowerCase().includes(ql));
      return [...found, ...local];
    })(),
    !TYPE_ENABLED.manga ? [] : fetchManga({ q }).catch(() => []),
    !TYPE_ENABLED.comic ? [] : fetchComics({ q }).catch(() => [])
  ]);
  if ($('searchInput').value.trim() !== q) return;
  searchData = { q, groups: { anime, tv, movie, manga, comic } };
  renderSearchResults();
}

