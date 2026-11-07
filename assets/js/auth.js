// ---- Accounts (Supabase) + guest mode ----
// Google is the only account method. Guests can still browse and keep data locally.
// Signed-in users sync their saved library, watch/read progress, and playback preferences.
'use strict';

const SB_VERSION = '2.110.9'; // pinned to a known stable Supabase JS v2 release
const SB_SRC = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SB_VERSION}/dist/umd/supabase.js`;
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
const AUTH_ON = !!(authCfg.url && authCfg.key);
let sb = null, sbUser = null, applyingCloud = false, pushTimer = null;
let pushing = false, pushAgain = false, localRevision = 0, pushedRevision = 0;
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
  sb = window.supabase.createClient(authCfg.url, authCfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return sb;
}

// ---------- local <-> cloud ----------
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
  writeLocal('animestream.mylist.v1', Array.isArray(data.my_list) ? data.my_list : []);
  writeLocal('animestream.continue.v1', Array.isArray(data.continue_watching) ? data.continue_watching : []);
  writeLocal('animestream.progress.v1', data.watch_progress && typeof data.watch_progress === 'object' ? data.watch_progress : {});
  writeLocal('animestream.mangaprogress.v1', data.manga_progress && typeof data.manga_progress === 'object' ? data.manga_progress : {});
  applyPreferences(data.preferences || {});
}
async function pullAndMerge() {
  if (!sb || !sbUser) return;
  const { data, error } = await sb.from('user_library')
    .select('my_list,continue_watching,watch_progress,manga_progress,preferences,updated_at')
    .eq('user_id', sbUser.id).maybeSingle();
  if (error) { console.warn('sync pull failed', error.message); flashNote('Could not load your cloud library. Check your connection.'); return; }
  const loc = localSnapshot();
  const merged = data ? {
    my_list: mergeLists(loc.my_list, data.my_list),
    continue_watching: mergeLists(loc.continue_watching, data.continue_watching).slice(0, 60),
    watch_progress: mergeProgress(loc.watch_progress, data.watch_progress),
    manga_progress: { ...(loc.manga_progress || {}), ...(data.manga_progress || {}) },
    preferences: { ...(loc.preferences || {}), ...(data.preferences || {}) }
  } : loc;
  applyCloudSnapshot(merged);
  await pushNow();
  try { updateSavedCount(); renderProfileChrome(); repaintOpenCollection(); } catch (_) {}
}
async function pushNow() {
  if (!sb || !sbUser) return false;
  if (pushing) { pushAgain = true; return false; }
  pushing = true;
  let succeeded = true;
  try {
    do {
      pushAgain = false;
      const revisionAtStart = localRevision;
      const row = { user_id: sbUser.id, ...localSnapshot(), updated_at: new Date().toISOString() };
      const { data, error } = await sb.from('user_library')
        .upsert(row, { onConflict: 'user_id' })
        .select('updated_at').single();
      if (error) {
        console.warn('sync push failed', error.message);
        succeeded = false;
        break;
      }
      rawSet.call(localStorage, SYNC_AT_KEY, data?.updated_at || row.updated_at);
      pushedRevision = revisionAtStart;
      if (localRevision !== revisionAtStart) pushAgain = true;
    } while (pushAgain);
  } finally {
    pushing = false;
    if (pushAgain) schedulePush();
  }
  return succeeded;
}
function schedulePush() {
  if (!sbUser) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushNow().catch(error => console.warn('sync push failed', error)); }, 900);
}
// Any user-owned saved-data or preference write queues a cloud push for signed-in users.
Storage.prototype.setItem = function (k, v) {
  rawSet.call(this, k, v);
  if (!applyingCloud && this === window.localStorage && (SYNC_JSON_KEYS[k] || SYNC_RAW_KEYS[k])) {
    localRevision++;
    schedulePush();
  }
};
// Pick up changes made on another device when the user returns to this tab.
async function pullIfNewer() {
  if (!sb || !sbUser || pushing || localRevision > pushedRevision) return;
  const { data, error } = await sb.from('user_library')
    .select('my_list,continue_watching,watch_progress,manga_progress,preferences,updated_at')
    .eq('user_id', sbUser.id).maybeSingle();
  if (error || !data) return;
  const mine = localStorage.getItem(SYNC_AT_KEY) || '';
  if (data.updated_at > mine) {
    applyCloudSnapshot(data);
    rawSet.call(localStorage, SYNC_AT_KEY, data.updated_at);
    try { updateSavedCount(); renderProfileChrome(); repaintOpenCollection(); } catch (_) {}
  }
}

// ---------- session state ----------
function nameFromUser(u) {
  const m = u?.user_metadata || {};
  return String(m.full_name || m.name || (u?.email || 'Member').split('@')[0]).slice(0, 24);
}
function applySession(user) {
  sbUser = user || null;
  if (user) {
    const prior = readProfile();
    writeProfile({ name: nameFromUser(user), cloud: true, created: prior?.cloud ? prior.created : Date.now() });
  } else {
    const p = readProfile();
    if (p && p.cloud) { try { localStorage.removeItem(PROFILE_KEY); } catch (_) {} }
  }
  renderProfileChrome();
}

// ---------- email + password auth ----------
let authMode = 'signin';
let authBusy = false;
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
  if (message.includes('invalid login credentials')) return 'That email and password do not match. Please try again.';
  if (message.includes('email not confirmed')) return 'Please confirm your email using the link we sent you before signing in.';
  if (message.includes('password should be at least') || message.includes('password is too short')) return 'Choose a password with at least 8 characters.';
  if (message.includes('user already registered')) return 'An account with this email already exists. Try signing in instead.';
  if (message.includes('rate limit') || message.includes('too many requests')) return 'Too many attempts. Please wait a little and try again.';
  if (message.includes('failed to fetch') || message.includes('network')) return 'Could not reach the sign-in service. Check your connection and try again.';
  return error?.message || 'Something went wrong. Please try again.';
}
function setAuthMode(mode) {
  const allowed = ['signin', 'signup', 'forgot', 'recovery'];
  if (!allowed.includes(mode)) mode = 'signin';
  authMode = mode;
  authErr('');
  authStatus('');

  const title = authElement('authTitle');
  const tabs = authElement('authTabs');
  const passwordWrap = authElement('authPasswordWrap');
  const confirmWrap = authElement('authConfirmWrap');
  const submit = authElement('authSubmit');
  const password = authElement('authPassword');
  const confirm = authElement('authPasswordConfirm');
  const signInActions = authElement('authActionsSignin');
  const signUpActions = authElement('authActionsSignup');
  const back = authElement('authBackButton');
  const email = authElement('authEmail');

  const titles = {
    signin: 'Sign in to AnimeStream',
    signup: 'Create your account',
    forgot: 'Reset your password',
    recovery: 'Choose a new password'
  };
  if (title) title.textContent = titles[mode];
  if (tabs) tabs.hidden = mode === 'forgot' || mode === 'recovery';
  if (passwordWrap) passwordWrap.hidden = mode === 'forgot';
  if (confirmWrap) confirmWrap.hidden = mode !== 'signup';
  if (password) {
    password.required = mode !== 'forgot';
    password.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    password.placeholder = mode === 'recovery' ? 'New password' : 'Password';
    if (mode === 'recovery') password.value = '';
  }
  if (confirm) { confirm.required = mode === 'signup'; confirm.value = ''; }
  if (submit) {
    submit.textContent = ({ signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', recovery: 'Save new password' })[mode];
    submit.disabled = false;
  }
  if (signInActions) signInActions.hidden = mode !== 'signin';
  if (signUpActions) signUpActions.hidden = mode !== 'signup';
  if (back) back.hidden = mode !== 'forgot' && mode !== 'recovery';
  if (email) email.autocomplete = 'email';
  ['signin', 'signup'].forEach(name => {
    const tab = authElement(name === 'signin' ? 'authTabSignin' : 'authTabSignup');
    if (tab) {
      tab.classList.toggle('active', mode === name);
      tab.setAttribute('aria-selected', mode === name ? 'true' : 'false');
    }
  });
  if (mode !== 'recovery') {
    const focusTarget = email;
    if (focusTarget && !authElement('loginModal')?.hidden) setTimeout(() => focusTarget.focus(), 30);
  } else if (!authElement('loginModal')?.hidden && password) {
    setTimeout(() => password.focus(), 30);
  }
}
function setAuthBusy(busy) {
  authBusy = !!busy;
  const submit = authElement('authSubmit');
  const form = authElement('cloudAuthForm');
  if (submit) {
    submit.disabled = authBusy;
    submit.textContent = authBusy ? 'Please wait…' : ({ signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', recovery: 'Save new password' })[authMode];
  }
  if (form) form.setAttribute('aria-busy', authBusy ? 'true' : 'false');
}
async function handleAuthSubmit(event) {
  if (event) event.preventDefault();
  if (authBusy) return false;
  authErr('');
  authStatus('');

  const emailInput = authElement('authEmail');
  const passwordInput = authElement('authPassword');
  const confirmInput = authElement('authPasswordConfirm');
  const email = String(emailInput?.value || '').trim().toLowerCase();
  const password = String(passwordInput?.value || '');
  const confirmation = String(confirmInput?.value || '');

  if (!email || !emailInput?.checkValidity()) {
    authErr('Enter a valid email address.');
    emailInput?.focus();
    return false;
  }
  if (authMode !== 'forgot' && password.length < 8) {
    authErr('Choose a password with at least 8 characters.');
    passwordInput?.focus();
    return false;
  }
  if (authMode === 'signup' && password !== confirmation) {
    authErr('The passwords do not match.');
    confirmInput?.focus();
    return false;
  }

  setAuthBusy(true);
  try {
    await getSb();
    if (authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/` }
      });
      if (error) throw error;
      if (data.session) {
        // The SIGNED_IN listener handles account setup and the first cloud merge.
        authStatus('Your account is ready. Signing you in…');
      } else {
        authStatus('Check your inbox for the confirmation link to finish creating your account.');
      }
    } else if (authMode === 'signin') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // The SIGNED_IN listener closes the modal after the session is established.
    } else if (authMode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}/`
      });
      if (error) throw error;
      authStatus('If an account exists for that email, a password-reset link will arrive shortly.');
    } else if (authMode === 'recovery') {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      closeLogin();
      flashNote('Your password has been updated.');
    }
  } catch (error) {
    authErr(authFriendlyError(error));
  } finally {
    setAuthBusy(false);
  }
  return false;
}

async function initAuth() {
  if (!AUTH_ON) return;
  try {
    await getSb();
    // Listen before reading the session so password-recovery redirects are not missed.
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setAuthMode('recovery');
        openLogin();
        setAuthMode('recovery');
        authStatus('Enter a new password for your account.');
      }
      if (event === 'SIGNED_IN' && session?.user && sbUser?.id !== session.user.id) {
        applySession(session.user);
        setTimeout(() => { pullAndMerge().catch(error => console.warn('sync pull failed', error)); }, 0);
        closeLogin();
        authErr('');
        flashNote(`Welcome, ${nameFromUser(session.user)}. Your library syncs across devices.`);
      }
      if (event === 'SIGNED_OUT') applySession(null);
    });
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    applySession(data.session?.user);
    if (data.session?.user) await pullAndMerge();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pullIfNewer().catch(() => {}); });
  } catch (error) {
    console.warn('Supabase unavailable; browsing remains available locally', error?.message || error);
  }
}

// Take over the existing profile-menu action when cloud auth is configured.
const _profileAuthAction = profileAuthAction;
profileAuthAction = async function () {
  const p = readProfile();
  if (AUTH_ON && p && p.cloud) {
    const saved = await pushNow();
    if (!saved) { flashNote('Your latest changes could not be synced. Check your connection before signing out.'); return; }
    try {
      const { error } = await sb.auth.signOut();
      if (error) { flashNote('Could not sign out. Please try again.'); return; }
    } catch (_) { flashNote('Could not sign out. Please try again.'); return; }
    // Shared-device safety: remove the signed-in user's saved data from this browser.
    [...Object.keys(SYNC_JSON_KEYS), ...Object.keys(SYNC_RAW_KEYS)].forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
    try { localStorage.removeItem(SYNC_AT_KEY); } catch (_) {}
    sbUser = null; applySession(null); updateSavedCount(); toggleProfileMenu(true); repaintOpenCollection();
    flashNote('Signed out. You are browsing as a guest.');
  } else if (AUTH_ON) {
    p ? _profileAuthAction() : openLogin();
  } else {
    _profileAuthAction();
  }
};

if (AUTH_ON) {
  const card = document.querySelector('#loginModal .login-card');
  if (card) card.classList.add('auth-on');
  document.documentElement.classList.add('auth-enabled');
  renderProfileChrome();
  setAuthMode('signin');
}
initAuth();
