// ---- AnimeStream custom accounts (database-backed; no Supabase Auth) ----
// Passwords are sent only to the server-side account Edge Function. The server
// stores salted PBKDF2 hashes and issues revocable, expiring opaque sessions.
'use strict';

const ACCOUNT_TOKEN_KEY = 'animestream.accountToken.v1';
const SYNC_JSON_KEYS = {
  'animestream.mylist.v1': 'my_list',
  'animestream.continue.v1': 'continue_watching',
  'animestream.progress.v1': 'watch_progress',
  'animestream.mangaprogress.v1': 'manga_progress',
  'player_settings': 'player_settings'
};
const SYNC_RAW_KEYS = {
  'animestream.lang': 'language',
  'animestream.autonext': 'auto_next',
  'animestream.manga.saver': 'manga_saver'
};
const SYNC_AT_KEY = 'animestream.syncedAt.v1';
const authCfg = window.AUTH_CONFIG || {};
const AUTH_ON = !!(authCfg.url && authCfg.key && authCfg.accountApi);
let accountUser = null, accountToken = '', applyingCloud = false, pushTimer = null;
let pushing = false, pushAgain = false, localRevision = 0, pushedRevision = 0;
let pendingAccountOpen = false;
const rawSet = Storage.prototype.setItem;

function readKey(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } }
function readRawKey(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function writeLocal(k, v) {
  applyingCloud = true;
  try { rawSet.call(localStorage, k, JSON.stringify(v)); }
  finally { applyingCloud = false; }
}
function writeRawLocal(k, v) {
  applyingCloud = true;
  try { rawSet.call(localStorage, k, String(v)); }
  finally { applyingCloud = false; }
}
function itemStamp(x) { return Number(x?._savedAt || x?._updatedAt || x?._at || x?._t || 0); }
function mergeLists(local, cloud) {
  const out = [], seen = new Map();
  [...(local || []), ...(cloud || [])].forEach(it => {
    const key = typeof mediaKey === 'function' ? mediaKey(it) : JSON.stringify(it);
    if (!seen.has(key)) { seen.set(key, out.length); out.push(it); }
    else if (itemStamp(it) > itemStamp(out[seen.get(key)])) out[seen.get(key)] = it;
  });
  return out.slice(0, 300);
}
function mergeProgress(local, cloud) {
  const out = { ...(cloud || {}) };
  Object.entries(local || {}).forEach(([k, v]) => { if (!out[k] || (v.t || 0) >= (out[k].t || 0)) out[k] = v; });
  return out;
}
function localPreferences() {
  const preferences = {};
  const language = readRawKey('animestream.lang');
  const autoNext = readRawKey('animestream.autonext');
  const mangaSaver = readRawKey('animestream.manga.saver');
  const playerSettings = readKey('player_settings');
  if (language !== null) preferences.language = language;
  if (autoNext !== null) preferences.auto_next = autoNext;
  if (mangaSaver !== null) preferences.manga_saver = mangaSaver;
  if (playerSettings && typeof playerSettings === 'object' && !Array.isArray(playerSettings)) preferences.player_settings = playerSettings;
  return preferences;
}
function localSnapshot() {
  return {
    my_list: readKey('animestream.mylist.v1') || [],
    continue_watching: readKey('animestream.continue.v1') || [],
    watch_progress: readKey('animestream.progress.v1') || {},
    manga_progress: readKey('animestream.mangaprogress.v1') || {},
    preferences: localPreferences()
  };
}
function applyPreferences(preferences) {
  if (!preferences || typeof preferences !== 'object') return;
  if (preferences.language != null) writeRawLocal('animestream.lang', preferences.language);
  if (preferences.auto_next != null) writeRawLocal('animestream.autonext', preferences.auto_next);
  if (preferences.manga_saver != null) writeRawLocal('animestream.manga.saver', preferences.manga_saver);
  if (preferences.player_settings && typeof preferences.player_settings === 'object') writeLocal('player_settings', preferences.player_settings);
}
function applyCloudSnapshot(data) {
  writeLocal('animestream.mylist.v1', Array.isArray(data?.my_list) ? data.my_list : []);
  writeLocal('animestream.continue.v1', Array.isArray(data?.continue_watching) ? data.continue_watching : []);
  writeLocal('animestream.progress.v1', data?.watch_progress && typeof data.watch_progress === 'object' ? data.watch_progress : {});
  writeLocal('animestream.mangaprogress.v1', data?.manga_progress && typeof data.manga_progress === 'object' ? data.manga_progress : {});
  applyPreferences(data?.preferences || {});
}
function accountName(u) {
  return String(u?.display_name || (u?.email || 'Member').split('@')[0] || 'Member').slice(0, 40);
}
function readToken() { try { return localStorage.getItem(ACCOUNT_TOKEN_KEY) || ''; } catch (_) { return ''; } }
async function accountApi(action, payload = {}, useSession = true) {
  if (!AUTH_ON) throw new Error('The account service is not configured.');
  const headers = { 'Content-Type': 'application/json', 'apikey': authCfg.key };
  const token = useSession ? (accountToken || readToken()) : '';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(authCfg.accountApi, {
    method: 'POST', headers, cache: 'no-store', credentials: 'omit',
    body: JSON.stringify({ action, ...payload })
  });
  let result;
  try { result = await response.json(); } catch (_) { result = {}; }
  if (!response.ok) {
    const error = new Error(result.error || 'Could not complete the account request.');
    error.status = response.status;
    throw error;
  }
  return result;
}
function authElement(id) { return document.getElementById(id); }
function authErr(message) {
  const element = authElement('authError');
  if (element) { element.textContent = message || ''; element.hidden = !message; }
}
function authStatus(message) {
  const element = authElement('authStatus');
  if (element) { element.textContent = message || ''; element.hidden = !message; }
}
function authFriendlyError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('failed to fetch') || message.includes('network')) return 'Could not reach the account service. Check your connection and try again.';
  return error?.message || 'Something went wrong. Please try again.';
}

// ---------- custom account session and library sync ----------
function applySession(user) {
  accountUser = user || null;
  if (user) {
    const prior = readProfile();
    writeProfile({
      name: accountName(user), email: user.email, cloud: true,
      created: prior?.cloud ? prior.created : (user.created_at ? Date.parse(user.created_at) : Date.now())
    });
  } else {
    const p = readProfile();
    if (p?.cloud) { try { localStorage.removeItem(PROFILE_KEY); } catch (_) {} }
  }
  renderProfileChrome();
  if (currentScreenId === 'accountView' && !user) goHome();
}
async function pullAndMerge(cloudData) {
  const loc = localSnapshot();
  const cloud = cloudData || {};
  const merged = {
    my_list: mergeLists(loc.my_list, cloud.my_list || []),
    continue_watching: mergeLists(loc.continue_watching, cloud.continue_watching || []).slice(0, 60),
    watch_progress: mergeProgress(loc.watch_progress, cloud.watch_progress),
    manga_progress: { ...(loc.manga_progress || {}), ...(cloud.manga_progress || {}) },
    preferences: { ...(loc.preferences || {}), ...(cloud.preferences || {}) }
  };
  applyCloudSnapshot(merged);
  await pushNow();
  try { updateSavedCount(); renderProfileChrome(); repaintOpenCollection(); if (currentScreenId === 'accountView') renderAccountView(); } catch (_) {}
}
async function pushNow() {
  if (!accountUser || !accountToken) return false;
  if (pushing) { pushAgain = true; return false; }
  pushing = true;
  let succeeded = true;
  try {
    do {
      pushAgain = false;
      const revisionAtStart = localRevision;
      const result = await accountApi('sync', { library: localSnapshot() });
      rawSet.call(localStorage, SYNC_AT_KEY, result.updated_at || new Date().toISOString());
      pushedRevision = revisionAtStart;
      if (localRevision !== revisionAtStart) pushAgain = true;
    } while (pushAgain);
  } catch (error) {
    console.warn('Account library sync failed', error?.message || error);
    succeeded = false;
    if (error?.status === 401) expireLocalSession();
  } finally {
    pushing = false;
    if (pushAgain && accountUser) schedulePush();
  }
  return succeeded;
}
function schedulePush() {
  if (!accountUser) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushNow().catch(error => console.warn('Account sync failed', error)); }, 900);
}
Storage.prototype.setItem = function (k, v) {
  rawSet.call(this, k, v);
  if (!applyingCloud && this === window.localStorage && (SYNC_JSON_KEYS[k] || SYNC_RAW_KEYS[k])) {
    localRevision++;
    schedulePush();
    if (currentScreenId === 'accountView') setTimeout(renderAccountView, 0);
  }
};
async function refreshAccountSession() {
  const result = await accountApi('session');
  applySession(result.account);
  const savedAt = localStorage.getItem(SYNC_AT_KEY) || '';
  const remoteAt = result.library?.updated_at || '';
  if (remoteAt && remoteAt > savedAt && localRevision <= pushedRevision) {
    applyCloudSnapshot(result.library);
    rawSet.call(localStorage, SYNC_AT_KEY, remoteAt);
    try { updateSavedCount(); repaintOpenCollection(); if (currentScreenId === 'accountView') renderAccountView(); } catch (_) {}
  }
  return result;
}
function expireLocalSession() {
  accountToken = '';
  try { localStorage.removeItem(ACCOUNT_TOKEN_KEY); } catch (_) {}
  applySession(null);
  flashNote('Your account session expired. Please sign in again.');
}
async function initAuth() {
  if (!AUTH_ON) return;
  accountToken = readToken();
  if (!accountToken) return;
  try {
    const result = await accountApi('session');
    applySession(result.account);
    await pullAndMerge(result.library);
  } catch (error) {
    if (error?.status === 401) {
      try { localStorage.removeItem(ACCOUNT_TOKEN_KEY); localStorage.removeItem(SYNC_AT_KEY); } catch (_) {}
      accountToken = '';
      applySession(null);
    } else console.warn('Account service unavailable; local browsing remains available.', error?.message || error);
  }
}

// ---------- login / registration modal ----------
let authMode = 'signin';
let authBusy = false;
function setAuthMode(mode) {
  authMode = mode === 'signup' ? 'signup' : 'signin';
  authErr(''); authStatus('');
  const title = authElement('authTitle');
  const submit = authElement('authSubmit');
  const confirmWrap = authElement('authConfirmWrap');
  const confirm = authElement('authPasswordConfirm');
  const password = authElement('authPassword');
  const signInActions = authElement('authActionsSignin');
  const signUpActions = authElement('authActionsSignup');
  if (title) title.textContent = authMode === 'signup' ? 'Create your account' : 'Sign in to AnimeStream';
  if (confirmWrap) confirmWrap.hidden = authMode !== 'signup';
  if (confirm) { confirm.required = authMode === 'signup'; confirm.value = ''; }
  if (password) { password.required = true; password.autocomplete = authMode === 'signin' ? 'current-password' : 'new-password'; }
  if (submit) { submit.textContent = authMode === 'signup' ? 'Create account' : 'Sign in'; submit.disabled = false; }
  if (signInActions) signInActions.hidden = authMode !== 'signin';
  if (signUpActions) signUpActions.hidden = authMode !== 'signup';
  ['signin', 'signup'].forEach(name => {
    const tab = authElement(name === 'signin' ? 'authTabSignin' : 'authTabSignup');
    if (tab) { tab.classList.toggle('active', authMode === name); tab.setAttribute('aria-selected', authMode === name ? 'true' : 'false'); }
  });
}
function setAuthBusy(busy) {
  authBusy = !!busy;
  const submit = authElement('authSubmit');
  const form = authElement('cloudAuthForm');
  if (submit) { submit.disabled = authBusy; submit.textContent = authBusy ? 'Please wait…' : (authMode === 'signup' ? 'Create account' : 'Sign in'); }
  if (form) form.setAttribute('aria-busy', authBusy ? 'true' : 'false');
}
async function handleAuthSubmit(event) {
  if (event) event.preventDefault();
  if (authBusy) return false;
  authErr(''); authStatus('');
  const emailInput = authElement('authEmail');
  const passwordInput = authElement('authPassword');
  const confirmInput = authElement('authPasswordConfirm');
  const email = String(emailInput?.value || '').trim().toLowerCase();
  const password = String(passwordInput?.value || '');
  const confirmation = String(confirmInput?.value || '');
  if (!email || !emailInput?.checkValidity()) { authErr('Enter a valid email address.'); emailInput?.focus(); return false; }
  if (password.length < 8) { authErr('Choose a password with at least 8 characters.'); passwordInput?.focus(); return false; }
  if (authMode === 'signup' && password !== confirmation) { authErr('The passwords do not match.'); confirmInput?.focus(); return false; }
  setAuthBusy(true);
  try {
    const result = await accountApi(authMode, { email, password }, false);
    accountToken = result.token;
    rawSet.call(localStorage, ACCOUNT_TOKEN_KEY, accountToken);
    rawSet.call(localStorage, SYNC_AT_KEY, result.library?.updated_at || '');
    applySession(result.account);
    await pullAndMerge(result.library);
    closeLogin();
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
    flashNote(authMode === 'signup' ? `Your AnimeStream account is ready, ${accountName(result.account)}.` : `Welcome back, ${accountName(result.account)}. Your library is synced.`);
    if (pendingAccountOpen) { pendingAccountOpen = false; openAccount(true); }
  } catch (error) {
    authErr(authFriendlyError(error));
  } finally { setAuthBusy(false); }
  return false;
}

// ---------- account library page ----------
function accountEsc(s) { return typeof escHtml === 'function' ? escHtml(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function accountKeyEncode(s) { return encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16)); }
function renderAccountCard(item, group) {
  const key = typeof mediaKey === 'function' ? mediaKey(item) : '';
  return `<div class="account-saved-item">${cardHTML(item)}<button type="button" class="account-remove" onclick="removeAccountItem('${group}','${accountKeyEncode(key)}')" aria-label="Remove ${accountEsc(item?._title || item?.title || 'saved title')}"><i class="ri-delete-bin-line" aria-hidden="true"></i><span>Remove</span></button></div>`;
}
function progressMedia(key, items) {
  const split = String(key).indexOf(':');
  if (split < 0) return null;
  const type = String(key).slice(0, split), id = String(key).slice(split + 1).toLowerCase();
  return (items || []).find(item => {
    const itemType = String(item?._type || item?.type || 'anime').toLowerCase();
    if (itemType !== type) return false;
    const ids = type === 'anime' ? [item.id, item.ani_id, item.mal_id, item.idMal]
      : type === 'movie' ? [item.imdb, item.tmdb, item.id]
      : [item.tvmaze, item.imdb, item.id];
    return ids.some(value => value != null && String(value).toLowerCase() === id);
  }) || null;
}
function progressText(key, value) {
  if (value && value.e != null) return key.startsWith('tv:') ? `Season ${(Number(value.s) || 1)} · Episode ${Number(value.e) + 1}` : `Episode ${Number(value.e) + 1}`;
  if (value && value.p > 0) return `${Math.floor(Number(value.p) / 60)} min watched`;
  return 'Watch progress saved';
}
function renderAccountView() {
  if (!accountUser) return;
  const snap = localSnapshot();
  const my = snap.my_list || [], cont = snap.continue_watching || [];
  const watch = Object.entries(snap.watch_progress || {}).sort((a,b) => (b[1]?.t || 0) - (a[1]?.t || 0));
  const knownMedia = [...my, ...cont];
  const manga = Object.entries(snap.manga_progress || {});
  const heading = authElement('accountHeading'); if (heading) heading.textContent = accountName(accountUser);
  const email = authElement('accountEmail'); if (email) email.textContent = accountUser.email || '';
  const count = (id, n, unit) => { const el = authElement(id); if (el) el.textContent = `${n} ${unit}${n === 1 ? '' : 's'}`; };
  count('accountSavedCount', my.length, 'saved title');
  count('accountContinueCount', cont.length, 'recent title');
  count('accountWatchCount', watch.length, 'watch position');
  count('accountMangaCount', manga.length, 'reading position');
  const fillCards = (id, items, group, empty) => {
    const el = authElement(id); if (!el) return;
    el.innerHTML = items.length ? items.map(item => renderAccountCard(item, group)).join('') : `<div class="account-empty">${empty}</div>`;
  };
  fillCards('accountMyListGrid', my, 'my_list', 'Nothing in My List yet.');
  fillCards('accountContinueGrid', cont, 'continue_watching', 'Nothing in Continue Watching yet.');
  const watchedEl = authElement('accountWatchRows');
  if (watchedEl) watchedEl.innerHTML = watch.length ? watch.map(([key,value]) => { const media = progressMedia(key, knownMedia); const title = media?._title || media?.title || value?.title || key; return `<div class="account-record"><div><strong>${accountEsc(title)}</strong><small>${accountEsc(progressText(key,value))}</small></div><button type="button" onclick="removeAccountItem('watch_progress','${accountKeyEncode(key)}')"><i class="ri-delete-bin-line" aria-hidden="true"></i> Remove</button></div>`; }).join('') : '<div class="account-empty">No watch positions saved yet.</div>';
  const mangaEl = authElement('accountMangaRows');
  if (mangaEl) mangaEl.innerHTML = manga.length ? manga.map(([id,chapter]) => `<div class="account-record"><div><strong>Manga / comic ${accountEsc(id)}</strong><small>Last chapter: ${accountEsc(chapter)}</small></div><button type="button" onclick="removeAccountItem('manga_progress','${accountKeyEncode(id)}')"><i class="ri-delete-bin-line" aria-hidden="true"></i> Remove</button></div>`).join('') : '<div class="account-empty">No reading progress saved yet.</div>';
}
function openAccount(silent = false) {
  if (!accountUser) { pendingAccountOpen = true; openLogin(); return; }
  if (!silent && typeof pushHist === 'function' && !applyingHistory) pushHist({ kind: 'account' });
  closeSearch(); toggleProfileMenu(true); closeDrawer();
  renderAccountView();
  showPage('accountView');
  setNav('account');
}
function removeAccountItem(group, encodedKey) {
  if (!accountUser) return;
  const key = decodeURIComponent(String(encodedKey || ''));
  if (group === 'my_list' || group === 'continue_watching') {
    const storeKey = group === 'my_list' ? 'animestream.mylist.v1' : 'animestream.continue.v1';
    const list = readKey(storeKey);
    const next = (Array.isArray(list) ? list : []).filter(item => mediaKey(item) !== key);
    writeLocal(storeKey, next);
  } else if (group === 'watch_progress') {
    const map = readKey('animestream.progress.v1') || {}; delete map[key]; writeLocal('animestream.progress.v1', map);
  } else if (group === 'manga_progress') {
    const map = readKey('animestream.mangaprogress.v1') || {}; delete map[key]; writeLocal('animestream.mangaprogress.v1', map);
  }
  localRevision++;
  schedulePush();
  updateSavedCount();
  repaintOpenCollection();
  renderAccountView();
  flashNote('Removed from your saved account data.');
}

// Profile menu sign-out action now revokes the custom database session.
profileAuthAction = async function () {
  if (!accountUser || !accountToken) { openLogin(); return; }
  const saved = await pushNow();
  if (!saved) { flashNote('Your latest changes could not be saved. Check your connection before signing out.'); return; }
  try { await accountApi('logout'); } catch (error) { if (error?.status !== 401) { flashNote('Could not sign out. Please try again.'); return; } }
  accountToken = '';
  try { localStorage.removeItem(ACCOUNT_TOKEN_KEY); } catch (_) {}
  [...Object.keys(SYNC_JSON_KEYS), ...Object.keys(SYNC_RAW_KEYS)].forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
  try { localStorage.removeItem(SYNC_AT_KEY); } catch (_) {}
  localRevision = 0; pushedRevision = 0;
  applySession(null); updateSavedCount(); toggleProfileMenu(true); repaintOpenCollection();
  goHome();
  flashNote('Signed out. Your account data remains saved online.');
};

if (AUTH_ON) {
  const card = document.querySelector('#loginModal .login-card');
  if (card) card.classList.add('auth-on');
  document.documentElement.classList.add('auth-enabled');
  renderProfileChrome();
  setAuthMode('signin');
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && accountUser && !pushing && localRevision <= pushedRevision) {
    refreshAccountSession().catch(error => { if (error?.status === 401) expireLocalSession(); });
  }
});
initAuth();
