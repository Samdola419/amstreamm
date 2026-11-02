/* Account storage bridge.
   Guests use browser localStorage. Signed-in users use the same local values as a
   fast browser cache and sync the personal anime library to their own Supabase row.
   Only My List, Continue Watching and episode/movie progress are account data.
*/
'use strict';

(function () {
  const KEYS = {
    myList: 'animestream.mylist.v1',
    continueWatching: 'animestream.continue.v1',
    watchProgress: 'animestream.progress.v1'
  };
  const GUEST_BACKUP_KEY = 'animestream.guest.backup.v1';
  const OWNER_KEY = 'animestream.storage.owner.v1';
  const state = {
    client: null, user: null, initialized: false, applying: false,
    syncTimer: null, syncChain: Promise.resolve(), loadingUser: null, loadingPromise: null
  };

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch (_) { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }
  function emptySnapshot() {
    return { myList: [], continueWatching: [], watchProgress: {} };
  }
  function readSnapshot() {
    return {
      myList: readJson(KEYS.myList, []),
      continueWatching: readJson(KEYS.continueWatching, []),
      watchProgress: readJson(KEYS.watchProgress, {})
    };
  }
  function writeSnapshot(snapshot) {
    state.applying = true;
    try {
      writeJson(KEYS.myList, Array.isArray(snapshot.myList) ? snapshot.myList : []);
      writeJson(KEYS.continueWatching, Array.isArray(snapshot.continueWatching) ? snapshot.continueWatching : []);
      writeJson(KEYS.watchProgress, snapshot.watchProgress && typeof snapshot.watchProgress === 'object' ? snapshot.watchProgress : {});
    } finally { state.applying = false; }
  }
  function mediaKey(item) {
    const m = item || {};
    return `${m._type || m.type || 'anime'}:${m.id || m.imdb || m.tmdb || m.tvmaze || m._title || m.title || ''}`.toLowerCase();
  }
  function mergeList(localList, cloudList, maxItems) {
    const all = new Map();
    [...(Array.isArray(cloudList) ? cloudList : []), ...(Array.isArray(localList) ? localList : [])].forEach(item => {
      if (!item || typeof item !== 'object') return;
      const key = mediaKey(item);
      if (!key.split(':').slice(1).join(':')) return;
      const prior = all.get(key);
      const merged = prior ? { ...prior, ...item } : { ...item };
      all.set(key, merged);
    });
    return [...all.values()].sort((a, b) =>
      Number(b._updatedAt || b._savedAt || 0) - Number(a._updatedAt || a._savedAt || 0)
    ).slice(0, maxItems);
  }
  function mergeSnapshots(localSnapshot, cloudSnapshot) {
    const local = localSnapshot || emptySnapshot();
    const cloud = cloudSnapshot || emptySnapshot();
    const watchProgress = { ...(cloud.watchProgress || {}) };
    Object.entries(local.watchProgress || {}).forEach(([key, value]) => {
      const old = watchProgress[key];
      if (!old || Number(value?.t || 0) >= Number(old?.t || 0)) watchProgress[key] = value;
    });
    return {
      myList: mergeList(local.myList, cloud.myList, 300),
      continueWatching: mergeList(local.continueWatching, cloud.continueWatching, 30),
      watchProgress
    };
  }
  function snapshotToRow(snapshot, userId) {
    return {
      user_id: userId,
      my_list: snapshot.myList,
      continue_watching: snapshot.continueWatching,
      watch_progress: snapshot.watchProgress,
      updated_at: new Date().toISOString()
    };
  }
  function rowToSnapshot(row) {
    return {
      myList: Array.isArray(row?.my_list) ? row.my_list : [],
      continueWatching: Array.isArray(row?.continue_watching) ? row.continue_watching : [],
      watchProgress: row?.watch_progress && typeof row.watch_progress === 'object' ? row.watch_progress : {}
    };
  }
  function scheduleSync() {
    if (!state.user || state.applying || !state.client) return;
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(() => syncNow().catch(error => {
      console.error('[account storage] Sync failed:', error);
      window.dispatchEvent(new CustomEvent('anime-account-sync-error', { detail: error }));
    }), 650);
  }
  async function syncNow() {
    if (!state.user || !state.client) return;
    const userId = state.user.id;
    const snapshot = readSnapshot();
    const row = snapshotToRow(snapshot, userId);
    state.syncChain = state.syncChain.catch(() => {}).then(async () => {
      if (!state.user || state.user.id !== userId) return;
      const { error } = await state.client.from('user_library').upsert(row, { onConflict: 'user_id' });
      if (error) throw error;
    });
    return state.syncChain;
  }
  async function loadForUser(user) {
    if (!user || !state.client) return;
    if (state.loadingUser === user.id && state.loadingPromise) return state.loadingPromise;
    state.loadingUser = user.id;
    state.loadingPromise = (async () => {
      const localSnapshot = readSnapshot();
      try {
        const owner = localStorage.getItem(OWNER_KEY);
        let guestSnapshot = null;
        if (owner !== user.id && !owner) {
          guestSnapshot = localSnapshot;
          writeJson(GUEST_BACKUP_KEY, guestSnapshot);
        }
        const { data, error } = await state.client
          .from('user_library')
          .select('my_list,continue_watching,watch_progress')
          .eq('user_id', user.id)
          .maybeSingle();
        if (error) throw error;
        const cloudSnapshot = rowToSnapshot(data);
        const shouldMergeLocal = !!guestSnapshot || (owner === user.id && !data);
        const merged = mergeSnapshots(shouldMergeLocal ? localSnapshot : emptySnapshot(), cloudSnapshot);
        if (state.user?.id !== user.id) return;
        writeSnapshot(merged);
        localStorage.setItem(OWNER_KEY, user.id);
        // Upload once on first account use, and keep merged guest data in sync.
        if (shouldMergeLocal || !data) await syncNow();
      } catch (error) {
        console.error('[account storage] Could not load cloud library:', error);
        if (state.user?.id === user.id && localStorage.getItem(OWNER_KEY) !== user.id) {
          // Do not label unsynced guest data as account data if the cloud read failed.
          state.user = null;
          throw error;
        }
        throw error;
      } finally {
        if (state.loadingUser === user.id) {
          state.loadingUser = null;
          state.loadingPromise = null;
        }
      }
    })();
    return state.loadingPromise;
  }
  async function activateUser(user) {
    if (!user) return;
    state.user = user;
    await loadForUser(user);
    window.dispatchEvent(new CustomEvent('anime-account-changed', { detail: { user } }));
  }
  async function signOut() {
    if (!state.client || !state.user) return;
    clearTimeout(state.syncTimer);
    await syncNow();
    const { error } = await state.client.auth.signOut();
    if (error) throw error;
    // SIGNED_OUT handler restores the browser's separate guest library.
  }
  function handleSignedOut() {
    clearTimeout(state.syncTimer);
    state.user = null;
    const backup = readJson(GUEST_BACKUP_KEY, null);
    if (backup) writeSnapshot(backup);
    else writeSnapshot(emptySnapshot());
    try {
      localStorage.removeItem(GUEST_BACKUP_KEY);
      localStorage.removeItem(OWNER_KEY);
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('anime-account-changed', { detail: { user: null } }));
  }
  function configuredClient() {
    const config = window.ANIMESTREAM_SUPABASE_CONFIG || {};
    const url = String(config.url || '').trim();
    const key = String(config.publishableKey || '').trim();
    if (!window.supabase?.createClient || !url.startsWith('https://') || !key || key.includes('YOUR_')) return null;
    try { return window.supabase.createClient(url, key); }
    catch (error) { console.error('[account storage] Supabase client setup failed:', error); return null; }
  }

  const ready = (async () => {
    state.client = configuredClient();
    if (!state.client) { state.initialized = true; return false; }
    const { data, error } = await state.client.auth.getSession();
    if (error) console.warn('[account storage] Could not restore auth session:', error.message);
    if (data?.session?.user) {
      state.user = data.session.user;
      try { await activateUser(data.session.user); }
      catch (e) { console.warn('[account storage] Cloud library unavailable; using current browser cache.', e); }
    }
    state.client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        handleSignedOut();
      } else if (event === 'SIGNED_IN' && session?.user && state.user?.id !== session.user.id) {
        Promise.resolve().then(() => activateUser(session.user)).catch(error => {
          console.error('[account storage] Sign-in library load failed:', error);
          window.dispatchEvent(new CustomEvent('anime-account-auth-error', { detail: error }));
        });
      }
    });
    state.initialized = true;
    return true;
  })().catch(error => {
    console.error('[account storage] Initialization failed:', error);
    state.initialized = true;
    return false;
  });

  window.AnimeAccount = {
    ready,
    get client() { return state.client; },
    get user() { return state.user; },
    get configured() { return !!state.client; },
    get isReady() { return state.initialized; },
    read(key, fallback) { return readJson(key, fallback); },
    write(key, value) {
      writeJson(key, value);
      if (Object.values(KEYS).includes(key)) scheduleSync();
    },
    async signUp(email, password) {
      if (!state.client) throw new Error('Account sign-in is not configured yet. Guest mode is available.');
      const { data, error } = await state.client.auth.signUp({ email, password });
      if (error) throw error;
      if (data.session?.user) await activateUser(data.session.user);
      return data;
    },
    async signIn(email, password) {
      if (!state.client) throw new Error('Account sign-in is not configured yet. Guest mode is available.');
      const { data, error } = await state.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.user) await activateUser(data.user);
      return data;
    },
    signOut,
    syncNow
  };
  window.addEventListener('online', () => { if (state.user) syncNow().catch(console.error); });
})();
