/* ----------------------------------------------------------------------
   AnimeStream cards, shelf rows, nav chrome, screen switching, in-app history
   ---------------------------------------------------------------------- */
function cardHTML(item) {
  if (!item) return '';
  const type = item._type || item.type || 'anime';
  const title = item._title || item.title || 'Untitled';
  const sub = item._sub || item.sub || '';
  const posters = posterCandidates(item);
  const poster = posters[0] || '';
  const key = registerMedia(item);
  const letter = title[0]?.toUpperCase() || '?';
  const safeTitle = escHtml(title);
  const img = poster
    ? `<img src="${escAttr(poster)}" data-poster-fallback="${escAttr(JSON.stringify(posters.slice(1)))}" alt="${safeTitle} poster" loading="lazy" decoding="async"${item._hideNoPoster ? ' data-hide-on-fail="1" onload="posterLoaded(this)"' : ''} onerror="handlePosterError(this)">` +
      `<div class="card-ph" style="display:none">${escHtml(letter)}</div>`
    : `<div class="card-ph">${escHtml(letter)}</div>`;
  const saved = isSaved(item);
  return `<div class="card" onclick="openDetailsByKey('${key}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openDetailsByKey('${key}')}" role="button" tabindex="0" aria-label="View details for ${safeTitle}">
    <div class="card-poster">
      ${img}
      <span class="card-type ${type}">${type === 'tv' ? 'series' : escHtml(type)}</span>
      <button class="card-add${saved ? ' saved' : ''}" type="button" onclick="event.stopPropagation();cardAddToggle(this,'${key}')" aria-label="${saved ? 'In My List' : 'Add to My List'}" title="${saved ? 'In My List' : 'Add to My List'}"><i class="${saved ? 'ri-check-line' : 'ri-add-line'}" aria-hidden="true"></i></button>
      ${progressLabel(item) ? `<span class="card-resume">${escHtml(progressLabel(item))}</span>` : ''}
      <div class="card-hover-actions"><span><i class="ri-information-line" aria-hidden="true"></i> View details</span></div>
    </div>
    <div class="card-title">${safeTitle}</div>
    <div class="card-sub">${escHtml(sub)}</div>
  </div>`;
}
function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escAttr(value) { return escHtml(value).replace(/`/g, '&#96;'); }
function rowHTML(titleHtml, items, moreMode, rowId, moreGenre) {
  if (!items?.length) return '';
  const id = rowId || ('row' + Math.random().toString(36).slice(2, 8));
  const more = moreMode
    ? `<button class="section-more" onclick="nav('${moreMode}'${moreGenre ? `,'${moreGenre}'` : ''})">View All <i class="ri-arrow-right-s-line" aria-hidden="true"></i></button>`
    : '';
  return `<section class="section">
    <div class="section-head">
      <h2 class="section-title">${titleHtml}</h2>
      ${more}
    </div>
    <div class="row-wrap">
      <div class="row" id="${id}">${items.map(cardHTML).join('')}</div>
    </div>
  </section>`;
}
(function rowDrag() {
  let row = null, startX = 0, startLeft = 0, moved = false;
  document.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const r = e.target.closest && e.target.closest('.row'); if (!r) return;
    row = r; startX = e.clientX; startLeft = r.scrollLeft; moved = false;
  });
  document.addEventListener('pointermove', e => {
    if (!row) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 6) { moved = true; row.classList.add('dragging'); }
    if (moved) row.scrollLeft = startLeft - dx;
  });
  const end = () => { if (row) { const r = row; setTimeout(() => r.classList.remove('dragging'), 0); } row = null; };
  document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
  document.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
})();
function scrollRow(id, dir) {
  const el = document.getElementById(id);
  if (el) el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.8, 600), behavior: 'smooth' });
}

/* Tiny in-app notice pill (no blocking dialogs) */
function flashNote(msg) {
  let el = document.getElementById('flashNote');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flashNote';
    el.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:900;background:#151515;border:1px solid rgba(255,255,255,.14);color:#fff;padding:10px 16px;border-radius:12px;font-size:.85rem;box-shadow:0 10px 30px rgba(0,0,0,.5);transition:opacity .25s ease;pointer-events:none';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(flashNote._t);
  flashNote._t = setTimeout(() => { el.style.opacity = '0'; }, 2600);
}
let currentScreenId = 'homeView';
function shouldHideTopNavForContext(screenId = currentScreenId) {
  const searchOpen = $('searchOverlay')?.classList.contains('show');
  const adOpen = $('vastAdOverlay')?.classList.contains('is-visible');
  // Dedicated immersive surfaces already provide their own navigation or controls.
  // Keep the dock off the player, item-detail hero, full-screen Search, and ad overlay.
  return screenId === 'playerView' || screenId === 'readerView' || screenId === 'detailView' || Boolean(searchOpen) || Boolean(adOpen);
}
/* Home hero sits behind the top bar: the bar goes see-through while the hero is at the top of the page. */
function syncHeroTop() {
  const hero = $('hero');
  const on = currentScreenId === 'homeView' && !!hero && !hero.hidden && (window.scrollY || 0) < 60;
  document.body.classList.toggle('hero-top', on);
}
function syncTopNavContext(screenId = currentScreenId) {
  const wrap = document.querySelector('.topnav-wrap');
  if (!wrap) return;
  const hideForContext = shouldHideTopNavForContext(screenId);
  syncHeroTop();
  wrap.classList.toggle('context-hidden', hideForContext);
  if (hideForContext) wrap.classList.remove('nav-hidden');
  else if ((window.scrollY || 0) < 38) wrap.classList.remove('nav-hidden');
}
function setNav(mode) {
  document.querySelectorAll('.nav-link, .yt-chip, .yt-drawer-item, .side-item').forEach(el => {
    if (!el.dataset.nav) return;
    el.classList.toggle('active', el.dataset.nav === mode);
  });
}
/* Left guide drawer (YouTube-style) */
function toggleDrawer() {
  const drawer = $('ytDrawer'), backdrop = $('drawerBackdrop');
  if (!drawer || !backdrop) return;
  const open = !drawer.classList.contains('open');
  drawer.classList.toggle('open', open);
  backdrop.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}
function closeDrawer() {
  $('ytDrawer')?.classList.remove('open');
  $('drawerBackdrop')?.classList.remove('open');
  document.body.style.overflow = '';
}
/* Nav search field hands off to the full search screen */
function navSearchOpen() {
  const input = $('searchInput');
  if (input) input.value = '';
  openSearch();
}
/* Circular add button on every poster card */
function cardAddToggle(btn, key) {
  const item = mediaRegistry.get(key);
  if (!item) return;
  const now = toggleSaved(item);
  btn.classList.toggle('saved', now);
  btn.innerHTML = now ? '<i class="ri-check-line" aria-hidden="true"></i>' : '<i class="ri-add-line" aria-hidden="true"></i>';
  const label = now ? 'In My List' : 'Add to My List';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const drawer = $('ytDrawer');
    if (drawer && drawer.classList.contains('open')) closeDrawer();
  }
});
function showPage(id) {
  currentScreenId = id;
  if (typeof syncHeroTop === 'function') syncHeroTop();
  ['homeView', 'browseView', 'playerView', 'detailView', 'myListView', 'continueView', 'comingView', 'mangaView', 'readerView', 'accountView'].forEach(pid => {
    const el = $(pid);
    if (!el) return;
    if (pid === id) {
      el.classList.remove('hidden-page');
      requestAnimationFrame(() => el.classList.add('active'));
    } else {
      el.classList.remove('active');
      setTimeout(() => { if (!el.classList.contains('active')) el.classList.add('hidden-page'); }, 280);
    }
  });
  if (id !== 'playerView' && $('player').getAttribute('src')) setPlayerSrc('');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.body.classList.toggle('no-side', id === 'playerView' || id === 'readerView' || id === 'detailView');
  syncBannerAd(id);
  syncTopNavContext(id);
}

/* In-app history. Each screen is a history entry, and a guard entry is
   pushed again on Back so the browser cannot leave the site. */
let applyingHistory = false;
const histStack = [{ kind: 'home' }];

function seedHistory() {
  const state = { app: 1, i: 0 };
  history.replaceState(state, '', location.href);
  history.pushState(state, '', location.href);
  histStack[0].pos = history.length - 1;
}
function pushHist(entry) {
  if (applyingHistory) return;
  try { if (localStorage.getItem('debugpush')) console.warn('[pushHist]', JSON.stringify(entry).slice(0, 150), new Error().stack.split('\n').slice(2, 5).join(' | ')); } catch (_) {}
  // Give each screen a real URL (clean routes). The URL is cosmetic for in-app
  // navigation; the direct-load path is parsed by routerBoot in router.js.
  entry.path = (typeof routeFor === 'function') ? routeFor(entry) : '';
  histStack.push(entry);
  history.pushState({ app: 1, i: histStack.length - 1 }, '',
    (entry.path && entry.path !== location.pathname) ? entry.path : location.href);
  entry.pos = history.length - 1; // where this page sits in the browser history
}
function rearmHistory() {
  history.pushState({ app: 1, i: Math.max(0, histStack.length - 1) }, '', location.href);
  if (histStack.length) histStack[histStack.length - 1].pos = history.length - 1;
}
function applyHist(entry) {
  applyingHistory = true;
  try {
    if (!entry || entry.kind === 'home') {
      browseMode = null;
      browseGenre = null;
      setNav('home');
      closeSearch();
      showPage('homeView');
    } else if (entry.kind === 'browse') {
      nav(entry.mode, entry.genre, true);
    } else if (entry.kind === 'player') {
      if (entry.playerType === 'movie') openMovie(entry.tmdb, entry.imdb, entry.title, true);
      else if (entry.playerType === 'tv') openTv(entry.imdb, entry.tvmaze, entry.title, true);
      else openAnime(entry.aniId, entry.malId, entry.title, entry.episodes, true);
    } else if (entry.kind === 'detail' && entry.media) {
      openDetails(entry.media, true);
    } else if (entry.kind === 'reader' && entry.media) {
      readManga(entry.media, entry.chapterId, true);
    } else if (entry.kind === 'comic' && entry.media) {
      readComic(entry.media, true);
    } else if (entry.kind === 'mylist') {
      openMyList(true);
    } else if (entry.kind === 'continue') {
      openContinue(true);
    }
  } finally {
    applyingHistory = false;
  }
}
window.addEventListener('popstate', () => {
  if ($('searchOverlay')?.classList.contains('show')) {
    closeSearch();
    rearmHistory();
    return;
  }
  if (histStack.length > 1) histStack.pop();
  applyHist(histStack[histStack.length - 1]);
  rearmHistory();
});
// Video sites inside the player add their own history entries, so one plain history.back() can land on one of theirs
// and the page looks unchanged. Jump straight to this app's previous page instead, however many entries sit in between.
function appBack() {
  const target = histStack[histStack.length - 2];
  let steps = target && Number.isInteger(target.pos) ? (history.length - 1) - target.pos : 1;
  if (steps < 1 || steps > history.length - 1) steps = 1;
  history.go(-steps);
}
function goHome() { nav('home'); }
