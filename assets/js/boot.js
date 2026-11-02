// ---- Boot: section gating, storage prune, first paint, smart nav ----
'use strict';
(function applySections(){
  document.querySelectorAll('[data-nav]').forEach(el => { if (NAV_ON[el.dataset.nav] === false) el.hidden = true; });
  document.querySelectorAll('[data-list-filter]').forEach(el => { const t = el.dataset.listFilter; if (t !== 'all' && TYPE_ENABLED[t] === false) el.hidden = true; });
  document.querySelectorAll('#searchFilters button').forEach(el => { const t = el.dataset.f; if (t !== 'all' && TYPE_ENABLED[t] === false) el.hidden = true; });
  if (ENABLED_TYPE_COUNT <= 1) { $('searchFilters').hidden = true; $('myListBar').hidden = true; }
  const si = $('searchInput'); if (si && ENABLED_TYPE_COUNT <= 1 && SECTIONS.anime) si.placeholder = 'Search anime';
})();
// Restore an authenticated user's cloud library before the first personal shelves render.
Promise.resolve(window.AnimeAccount?.ready).catch(() => false).then(() => {
  updateSavedCount();
  syncNextUI();
  loadHome();
  seedHistory();
  routerBoot();
});

// Context-aware liquid-glass dock: auto-hide on scroll down, reveal on scroll up/top edge,
// but never cover the video controls/player screen or the dedicated Search surface.
(function setupSmartGlassNav(){
  const wrap=document.querySelector('.topnav-wrap');
  if(!wrap) return;
  let lastY=window.scrollY||0, busy=false;
  const contextMustHide=()=> shouldHideTopNavForContext(currentScreenId);
  const forceVisible=()=> $('profileMenu')?.classList.contains('open') || document.activeElement?.closest?.('.topnav');
  function update(){
    const y=window.scrollY||0;
    if(contextMustHide()) {
      wrap.classList.add('context-hidden');
      wrap.classList.remove('nav-hidden');
    } else {
      wrap.classList.remove('context-hidden');
      if(y<38 || forceVisible()) wrap.classList.remove('nav-hidden');
      else if(y>lastY+7) wrap.classList.add('nav-hidden');
      else if(y<lastY-5) wrap.classList.remove('nav-hidden');
    }
    lastY=y;busy=false;
  }
  window.addEventListener('scroll',()=>{if(!busy){busy=true;requestAnimationFrame(update);}},{passive:true});
  const adLayer=$('vastAdOverlay');
  if(adLayer && 'MutationObserver' in window){
    new MutationObserver(()=>{ syncTopNavContext(); update(); }).observe(adLayer,{attributes:true,attributeFilter:['class','style']});
  }
  document.addEventListener('pointermove',e=>{
    if(e.clientY<42 && !contextMustHide()) wrap.classList.remove('nav-hidden');
  },{passive:true});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && !contextMustHide()) wrap.classList.remove('nav-hidden');
  });
  document.addEventListener('focusin',e=>{
    if((e.target.closest('.topnav') || e.target.closest('#searchOverlay')) && !contextMustHide()) wrap.classList.remove('nav-hidden');
  });
  syncTopNavContext();
})();
