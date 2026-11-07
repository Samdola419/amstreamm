// ---- Local profile ("login") ----
// Each device keeps its own profile in localStorage — no accounts, no server.
// The login screen is the polished face of that local space: name it once and
// Continue Watching, episode positions and My List all stay on this phone/PC.
'use strict';

const PROFILE_KEY = 'animestream.profile.v1';

function readProfile() { try { const v = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); return v && typeof v === 'object' && v.name ? v : null; } catch (_) { return null; } }
function writeProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (_) {} }
function profileInitial(p) { return (p && p.name && String(p.name).trim()[0] || 'A').toUpperCase(); }

function renderProfileChrome() {
  const p = readProfile();
  const letter = profileInitial(p);
  document.querySelectorAll('.nav-avatar, .profile-avatar').forEach(el => { el.textContent = letter; });
  const trigger = document.querySelector('.profile-trigger');
  if (trigger) trigger.hidden = !p; // guests see only the Log in button, not a half-finished avatar
  const top = document.querySelector('#profileMenu .profile-menu-top');
  if (top) {
    const strong = top.querySelector('strong'), small = top.querySelector('small');
    if (strong) strong.textContent = p ? p.name : 'AnimeStream';
    if (small) small.textContent = p ? (p.cloud ? 'Saved across devices' : 'Saved on this device only') : 'Your personal space';
  }
  const pill = document.getElementById('loginPill');
  if (pill) pill.hidden = !!p;
  const authBtn = document.getElementById('profileAuthBtn');
  if (authBtn) authBtn.innerHTML = p ? '<span class="profile-menu-item"><i class="ri-logout-box-line" aria-hidden="true"></i> Sign out</span>' : (document.documentElement.classList.contains('auth-enabled') ? '<span class="profile-menu-item"><i class="ri-mail-line" aria-hidden="true"></i> Sign in / create account</span>' : '<span class="profile-menu-item"><i class="ri-user-add-line" aria-hidden="true"></i> Create local profile</span>');
  const watched = document.getElementById('watchedCount');
  if (watched) watched.textContent = String(Object.keys(readProgress()).length);
}

/* Side panel: icons-only rail by default, one tap opens the full menu.
   The choice sticks on this device. */
function toggleSideNav() {
  const mini = !document.body.classList.contains('side-mini');
  document.body.classList.toggle('side-mini', mini);
  try { localStorage.setItem('animestream.sidebar', mini ? 'mini' : 'open'); } catch (_) {}
}
(function restoreSideNav() {
  let pref = 'mini';
  try { pref = localStorage.getItem('animestream.sidebar') || 'mini'; } catch (_) {}
  document.body.classList.toggle('side-mini', pref !== 'open');
})();

function openLogin() {
  closeSearch(); toggleProfileMenu(true);
  const modal = $('loginModal');
  if (!modal) return;
  modal.hidden = false;
  const input = document.documentElement.classList.contains('auth-enabled') ? $('authEmail') : $('loginName');
  if (input) setTimeout(() => input.focus(), 60);
}
function closeLogin() { const m = $('loginModal'); if (m) m.hidden = true; }
function saveProfile() {
  const entry = $('loginName');
  const name = ((entry && entry.value) || '').trim().slice(0, 24);
  if (!name) { flashNote('A name is all we need \u2014 even a nickname works.'); return; }
  writeProfile({ name, created: Date.now() });
  renderProfileChrome();
  closeLogin();
  flashNote(`Welcome, ${name} \u2014 Continue Watching and My List are saved on this device.`);
}
function profileAuthAction() {
  if (readProfile()) {
    localStorage.removeItem(PROFILE_KEY);
    renderProfileChrome();
    toggleProfileMenu(true);
    flashNote('Signed out \u2014 your device is back to guest mode.');
  } else {
    openLogin();
  }
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLogin(); });
renderProfileChrome();
