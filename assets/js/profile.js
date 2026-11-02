// ---- Account login and guest mode ----
'use strict';

let authMode = 'signup';
let authBusy = false;

function currentAccountUser() { return window.AnimeAccount?.user || null; }
function profileInitial(user) {
  const value = user?.email || 'A';
  return String(value).trim()[0]?.toUpperCase() || 'A';
}
function renderProfileChrome() {
  const user = currentAccountUser();
  const letter = profileInitial(user);
  document.querySelectorAll('.nav-avatar, .profile-avatar').forEach(el => { el.textContent = letter; });
  const trigger = document.querySelector('.profile-trigger');
  if (trigger) trigger.hidden = !user;
  const top = document.querySelector('#profileMenu .profile-menu-top');
  if (top) {
    const strong = top.querySelector('strong'), small = top.querySelector('small');
    if (strong) strong.textContent = user ? user.email : 'Guest mode';
    if (small) small.textContent = user ? 'Synced with your account' : 'Saved on this browser';
  }
  const pill = document.getElementById('loginPill');
  if (pill) pill.hidden = !!user;
  const authBtn = document.getElementById('profileAuthBtn');
  if (authBtn) authBtn.innerHTML = user
    ? '<span class="profile-menu-item"><i class="ri-logout-box-line" aria-hidden="true"></i> Sign out</span>'
    : '<span class="profile-menu-item"><i class="ri-user-add-line" aria-hidden="true"></i> Create account / Log in</span>';
  const watched = document.getElementById('watchedCount');
  if (watched && typeof readProgress === 'function') watched.textContent = String(Object.keys(readProgress()).length);
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

function setAuthStatus(message, isError = false) {
  const el = $('authStatus');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', !!isError);
  el.hidden = !message;
}
function renderAuthMode() {
  const submit = $('authSubmit'), switchLine = $('authModeSwitch');
  const switchButton = $('authModeSwitchBtn');
  if (submit) submit.innerHTML = authMode === 'signup'
    ? '<i class="ri-user-add-line" aria-hidden="true"></i> Create account'
    : '<i class="ri-login-box-line" aria-hidden="true"></i> Log in';
  if (switchLine) switchLine.firstChild.textContent = authMode === 'signup' ? 'Already have an account? ' : 'New to AnimeStream? ';
  if (switchButton) switchButton.textContent = authMode === 'signup' ? 'Log in' : 'Create account';
  const password = $('authPassword');
  if (password) password.autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
}
function openLogin() {
  closeSearch(); toggleProfileMenu(true);
  const modal = $('loginModal');
  if (!modal) return;
  modal.hidden = false;
  setAuthStatus('');
  const configured = !!window.AnimeAccount?.configured;
  if ($('authForm')) $('authForm').hidden = !configured;
  if ($('authModeSwitch')) $('authModeSwitch').hidden = !configured;
  if ($('authUnavailable')) $('authUnavailable').hidden = configured;
  if (configured) {
    renderAuthMode();
    const input = $('authEmail');
    if (input) setTimeout(() => input.focus(), 60);
  }
}
function closeLogin() { const modal = $('loginModal'); if (modal) modal.hidden = true; }
function switchAuthMode() {
  authMode = authMode === 'signup' ? 'signin' : 'signup';
  setAuthStatus('');
  renderAuthMode();
}
async function submitAccountAuth() {
  if (authBusy) return;
  const email = String($('authEmail')?.value || '').trim();
  const password = String($('authPassword')?.value || '');
  if (!email || !password) { setAuthStatus('Enter your email and password.', true); return; }
  if (authMode === 'signup' && password.length < 6) { setAuthStatus('Use a password with at least 6 characters.', true); return; }
  authBusy = true;
  const submit = $('authSubmit');
  if (submit) { submit.disabled = true; submit.textContent = authMode === 'signup' ? 'Creating account…' : 'Logging in…'; }
  setAuthStatus('');
  try {
    if (authMode === 'signup') {
      const data = await window.AnimeAccount.signUp(email, password);
      if (data.session?.user) {
        closeLogin(); renderProfileChrome();
        flashNote('Account created. Your My List and watch progress are now synced.');
      } else {
        setAuthStatus('Check your email for the confirmation link. After confirming, log in here to sync your library.');
      }
    } else {
      await window.AnimeAccount.signIn(email, password);
      closeLogin(); renderProfileChrome();
      flashNote('Welcome back. Your AnimeStream library is synced.');
    }
  } catch (error) {
    setAuthStatus(error?.message || 'Could not complete that request. Please try again.', true);
  } finally {
    authBusy = false;
    if (submit) { submit.disabled = false; renderAuthMode(); }
  }
}
function continueAsGuest() {
  closeLogin();
  renderProfileChrome();
  flashNote('Guest mode active. Your My List and watch progress stay in this browser.');
}
async function profileAuthAction() {
  if (!currentAccountUser()) { openLogin(); return; }
  try {
    const button = $('profileAuthBtn');
    if (button) button.disabled = true;
    await window.AnimeAccount.signOut();
    renderProfileChrome();
    toggleProfileMenu(true);
    flashNote('Signed out. Guest mode is active and its browser data is separate from your account.');
  } catch (error) {
    flashNote(error?.message || 'Could not sign out because your library has not synced yet.');
  } finally {
    const button = $('profileAuthBtn');
    if (button) button.disabled = false;
  }
}

window.addEventListener('anime-account-changed', renderProfileChrome);
window.addEventListener('anime-account-sync-error', () => flashNote('Your latest changes could not sync. They remain in this browser and will retry when you are online.'));
window.addEventListener('anime-account-auth-error', event => setAuthStatus(event.detail?.message || 'Could not load your account library.', true));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLogin(); });
renderProfileChrome();
