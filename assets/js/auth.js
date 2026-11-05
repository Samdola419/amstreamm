// ---- Accounts (Supabase) + guest mode ----
// Guest = default, nothing leaves the device. Account = email/password or Google, lists sync to Supabase.
// If assets/js/auth-config.js is empty, this file does nothing and the site stays guest-only.
'use strict';

const SB_VERSION = '2.110.9'; // pinned, never "latest"
const SB_SRC = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SB_VERSION}/dist/umd/supabase.js`;
const SYNC_KEYS = { 'animestream.mylist.v1': 'my_list', 'animestream.continue.v1': 'continue_watching', 'animestream.progress.v1': 'watch_progress' };
const SYNC_AT_KEY = 'animestream.syncedAt.v1';

const authCfg = window.AUTH_CONFIG || {};
const AUTH_ON = !!(authCfg.url && authCfg.key);
let sb = null, sbUser = null, authMode = 'in', applyingCloud = false, pushTimer = null, pushing = false;
const rawSet = Storage.prototype.setItem;

function loadSupabaseLib() {
  return new Promise((resolve, reject) => {
    if (window.supabase && window.supabase.createClient) return resolve();
    const s = document.createElement('script');
    s.src = SB_SRC; s.async = true; s.onload = () => resolve(); s.onerror = () => reject(new Error('load'));
    document.head.appendChild(s);
  });
}
async function getSb() {
  if (sb) return sb;
  await loadSupabaseLib();
  sb = window.supabase.createClient(authCfg.url, authCfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return sb;
}

// ---------- local <-> cloud ----------
function readKey(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } }
function writeLocal(k, v) { applyingCloud = true; try { rawSet.call(localStorage, k, JSON.stringify(v)); } finally { applyingCloud = false; } }
function itemStamp(x) { return Number(x?._savedAt || x?._at || x?._t || 0); }
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
function localSnapshot() {
  return { my_list: readKey('animestream.mylist.v1') || [], continue_watching: readKey('animestream.continue.v1') || [], watch_progress: readKey('animestream.progress.v1') || {} };
}
async function pullAndMerge() {
  if (!sb || !sbUser) return;
  const { data, error } = await sb.from('user_library').select('my_list,continue_watching,watch_progress,updated_at').eq('user_id', sbUser.id).maybeSingle();
  if (error) { console.warn('sync pull failed', error.message); return; }
  const loc = localSnapshot();
  const merged = data
    ? { my_list: mergeLists(loc.my_list, data.my_list), continue_watching: mergeLists(loc.continue_watching, data.continue_watching).slice(0, 60), watch_progress: mergeProgress(loc.watch_progress, data.watch_progress) }
    : loc;
  writeLocal('animestream.mylist.v1', merged.my_list);
  writeLocal('animestream.continue.v1', merged.continue_watching);
  writeLocal('animestream.progress.v1', merged.watch_progress);
  await pushNow();
  try { updateSavedCount(); renderProfileChrome(); repaintOpenCollection(); } catch (_) {}
}
async function pushNow() {
  if (!sb || !sbUser || pushing) return;
  pushing = true;
  try {
    const row = { user_id: sbUser.id, ...localSnapshot(), updated_at: new Date().toISOString() };
    const { error } = await sb.from('user_library').upsert(row, { onConflict: 'user_id' });
    if (error) console.warn('sync push failed', error.message); else rawSet.call(localStorage, SYNC_AT_KEY, row.updated_at);
  } finally { pushing = false; }
}
function schedulePush() { if (!sbUser) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 2500); }
// Any write to the three synced keys queues a cloud push (signed-in only). Guests are untouched.
Storage.prototype.setItem = function (k, v) {
  rawSet.call(this, k, v);
  if (!applyingCloud && this === window.localStorage && SYNC_KEYS[k]) schedulePush();
};
// Picking up changes made on another device when you come back to the tab.
async function pullIfNewer() {
  if (!sb || !sbUser || pushing) return;
  const { data } = await sb.from('user_library').select('my_list,continue_watching,watch_progress,updated_at').eq('user_id', sbUser.id).maybeSingle();
  if (!data) return;
  const mine = localStorage.getItem(SYNC_AT_KEY) || '';
  if (data.updated_at > mine) {
    writeLocal('animestream.mylist.v1', data.my_list || []);
    writeLocal('animestream.continue.v1', data.continue_watching || []);
    writeLocal('animestream.progress.v1', data.watch_progress || {});
    rawSet.call(localStorage, SYNC_AT_KEY, data.updated_at);
    try { updateSavedCount(); repaintOpenCollection(); } catch (_) {}
  }
}

// ---------- session state ----------
function nameFromUser(u) {
  const m = u?.user_metadata || {};
  return String(m.full_name || m.name || (u?.email || 'Member').split('@')[0]).slice(0, 24);
}
function applySession(user) {
  sbUser = user || null;
  if (user) writeProfile({ name: nameFromUser(user), cloud: true, created: Date.now() });
  else { const p = readProfile(); if (p && p.cloud) { try { localStorage.removeItem(PROFILE_KEY); } catch (_) {} } }
  renderProfileChrome();
}
async function initAuth() {
  if (!AUTH_ON) return;
  try {
    await getSb();
    const { data } = await sb.auth.getSession();
    applySession(data.session?.user);
    if (data.session?.user) pullAndMerge();
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user && !sbUser) { applySession(session.user); setTimeout(pullAndMerge, 0); closeLogin(); flashNote(`Welcome, ${nameFromUser(session.user)}. Your list syncs across devices.`); }
      if (event === 'SIGNED_OUT') applySession(null);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pullIfNewer().catch(() => {}); });
  } catch (_) { console.warn('Supabase unavailable, staying in guest mode'); }
}

// ---------- login screen ----------
function authErr(msg) { const e = $('authError'); if (e) { e.textContent = msg || ''; e.hidden = !msg; } }
function friendlyAuthError(error) {
  const m = String(error?.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'Wrong email or password.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'That email already has an account. Try signing in.';
  if (m.includes('password')) return 'Password must be at least 8 characters.';
  if (m.includes('rate') || m.includes('too many')) return 'Too many tries. Wait a minute and try again.';
  if (m.includes('email')) return 'Check the email address and try again.';
  return 'Something went wrong. Try again.';
}
function setAuthMode(mode) {
  authMode = mode;
  const go = $('authSubmit'); if (go) go.textContent = mode === 'up' ? 'Create account' : 'Sign in';
  const title = $('authTitle'); if (title) title.textContent = mode === 'up' ? 'Create account' : 'Sign in';
  const sw = $('authSwitch'); if (sw) sw.textContent = mode === 'up' ? 'I have an account' : 'Create account';
  const pw = $('authPassword'); if (pw) { pw.autocomplete = mode === 'up' ? 'new-password' : 'current-password'; pw.placeholder = mode === 'up' ? 'Password (8+ characters)' : 'Password'; }
  authErr('');
}
async function submitAuth() {
  const email = ($('authEmail').value || '').trim(), password = $('authPassword').value || '';
  if (!email || !password) return authErr('Enter your email and password.');
  if (authMode === 'up' && password.length < 8) return authErr('Password must be at least 8 characters.');
  const go = $('authSubmit'); go.disabled = true; authErr('');
  try {
    await getSb();
    if (authMode === 'up') {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
      if (error) return authErr(friendlyAuthError(error));
      if (!data.session) { closeLogin(); flashNote('Check your email to confirm your account, then sign in.'); }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return authErr(friendlyAuthError(error));
    }
  } catch (_) { authErr('Could not reach the server. Check your connection.'); }
  finally { go.disabled = false; }
}
async function googleAuth() {
  authErr('');
  try { await getSb(); const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } }); if (error) authErr('Google sign-in is not set up yet.'); }
  catch (_) { authErr('Could not reach the server. Check your connection.'); }
}
async function resetPassword() {
  const email = ($('authEmail').value || '').trim();
  if (!email) return authErr('Type your email above first.');
  try { await getSb(); const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); if (error) return authErr(friendlyAuthError(error)); closeLogin(); flashNote('Password reset email sent.'); }
  catch (_) { authErr('Could not reach the server.'); }
}

// Take over the existing hooks, keeping the local-profile behavior as the fallback.
const _openLogin = openLogin, _profileAuthAction = profileAuthAction;
openLogin = function () {
  if (!AUTH_ON) return _openLogin();
  closeSearch(); toggleProfileMenu(true);
  const modal = $('loginModal'); if (!modal) return;
  setAuthMode('in'); authErr('');
  modal.hidden = false;
  setTimeout(() => $('authEmail')?.focus(), 60);
};
profileAuthAction = async function () {
  const p = readProfile();
  if (AUTH_ON && p && p.cloud) {
    try { await pushNow(); await getSb(); await sb.auth.signOut(); } catch (_) {}
    // shared-device safety: your data lives in the cloud, so clear it from this browser
    Object.keys(SYNC_KEYS).forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
    try { localStorage.removeItem(SYNC_AT_KEY); } catch (_) {}
    sbUser = null; applySession(null); updateSavedCount(); toggleProfileMenu(true); repaintOpenCollection();
    flashNote('Signed out. You are browsing as a guest.');
  } else if (AUTH_ON) { p ? _profileAuthAction() : openLogin(); }
  else _profileAuthAction();
};
if (AUTH_ON) {
  const card = document.querySelector('#loginModal .login-card');
  if (card) card.classList.add('auth-on');
  document.documentElement.classList.add('auth-enabled');
}
initAuth();
