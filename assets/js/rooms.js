// AnimeStream Watch Rooms.
// Each member streams locally. The host's normal player controls publish signed,
// server-validated playback events; guests receive those events over Supabase Realtime.
'use strict';

let activeRoom = null;
let roomRt = null;
let roomChannel = null;
let roomPollTimer = null;
let roomHeartbeatTimer = null;
let roomRefreshTimer = null;
let roomReconnectTimer = null;
let roomControlQueue = Promise.resolve();
let roomLastRevision = 0;
let roomLastPlaybackRevision = 0;
let roomPlaybackSeq = 0;
let roomLastPosition = 0;
let roomPlayerIsPlaying = false;
let roomLastProgressAt = 0;
let roomLastHostProgressMessageAt = 0;
let roomHostPauseTimer = null;
let roomLastPlaybackUpdatedAt = '';
let roomApplying = false;
let roomPendingCode = '';
let roomSeenMessages = new Set();
let roomChannelTopic = '';
let roomRealtimeConnected = false;
let roomHostPrivateKey = null;
let roomHostPublicKey = null;
let roomHostKeyPromise = null;
let roomGuestVerifyKey = null;
let roomGuestVerifyKeyText = '';
let roomLastHostSequence = 0;
let roomLastPlayerTickAt = Date.now();
let roomLastPlaybackAdvanceAt = Date.now();
let roomLastGuestPlayCommandAt = 0;
let roomLastGuestPauseCommandAt = 0;
let roomLastCorrectionAt = 0;
let roomExplicitPauseAt = 0;
let roomStationaryHostTicks = 0;
let roomLastStationaryHostTickAt = 0;
let roomStateStreamTimer = null;
let roomLastStateBroadcastAt = 0;
let roomLastPersistAt = 0;
let roomLocalVolume = 0.8;

const roomCfg = window.AUTH_CONFIG || {};
const ROOM_API = roomCfg.roomsApi || (roomCfg.url ? `${roomCfg.url}/functions/v1/rooms-api` : '');
const ROOM_POLL_MS = 1500;
const ROOM_PROGRESS_MS = 5000;
const ROOM_STATE_PLAYING_MS = 1000;
const ROOM_STATE_PAUSED_MS = 2500;
const ROOM_DRIFT_TOLERANCE = 0.5;
const ROOM_DRIFT_SEEK_THRESHOLD = 1.25;
const ROOM_HOST_STALL_MS = 2800;
const ROOM_GUEST_PAUSE_RETRY_MS = 1100;
const ROOM_HOST_STATIONARY_TICKS = 2;

function roomEl(id) { return document.getElementById(id); }
function roomEsc(value) {
  return typeof escHtml === 'function'
    ? escHtml(String(value ?? ''))
    : String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function roomToken() {
  return typeof accountTokenValue === 'function'
    ? accountTokenValue()
    : localStorage.getItem('animestream.accountToken.v1') || '';
}
function roomToast(message) { if (typeof flashNote === 'function') flashNote(message); }
function roomBytesToB64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function roomB64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function roomHostKeyStorageName(roomId) { return `animestream.room.host-key.v1:${roomId}`; }
async function roomCreateHostKeyPair() {
  if (!window.crypto?.subtle) throw new Error('This browser cannot securely sign live room updates. Update your browser and try again.');
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    publicKey: roomBytesToB64(await crypto.subtle.exportKey('spki', pair.publicKey)),
    privateKey: roomBytesToB64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    importedPrivateKey: pair.privateKey
  };
}
async function roomLoadHostPrivateKey(roomId) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(roomHostKeyStorageName(roomId)) || 'null');
    if (!stored?.privateKey || !stored?.publicKey) return null;
    const privateKey = await crypto.subtle.importKey('pkcs8', roomB64ToBytes(stored.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return { privateKey, publicKey: stored.publicKey };
  } catch (error) { console.warn('Could not restore host signing key', error); return null; }
}
async function roomEnsureHostSigningKey() {
  if (!activeRoom || !roomIsHost()) return false;
  const roomId = activeRoom.room.id;
  const hostAccountId = activeRoom.room.host_account_id;
  const expectedPublicKey = activeRoom.room.host_signing_public_key || '';
  if (roomHostPrivateKey && roomHostPublicKey === expectedPublicKey) return true;
  if (roomHostKeyPromise) return roomHostKeyPromise;
  roomHostKeyPromise = (async () => {
    const restored = await roomLoadHostPrivateKey(roomId);
    if (activeRoom?.room?.id !== roomId || !roomIsHost()) return false;
    if (restored && restored.publicKey === expectedPublicKey) {
      roomHostPrivateKey = restored.privateKey;
      roomHostPublicKey = restored.publicKey;
      return true;
    }
    const pair = await roomCreateHostKeyPair();
    if (activeRoom?.room?.id !== roomId || activeRoom.room.host_account_id !== hostAccountId || !roomIsHost()) return false;
    try { sessionStorage.setItem(roomHostKeyStorageName(roomId), JSON.stringify({ publicKey: pair.publicKey, privateKey: pair.privateKey })); }
    catch (_) { throw new Error('This browser could not store the room signing key for this tab.'); }
    const updated = await roomApi('set_host_signing_key', { room_id: roomId, public_key: pair.publicKey });
    if (activeRoom?.room?.id !== roomId || !roomIsHost()) return false;
    roomHostPrivateKey = pair.importedPrivateKey;
    roomHostPublicKey = pair.publicKey;
    activeRoom.room.host_signing_public_key = updated?.room?.host_signing_public_key || pair.publicKey;
    return true;
  })();
  try { return await roomHostKeyPromise; }
  finally { roomHostKeyPromise = null; }
}
async function roomGetGuestVerifyKey() {
  const encoded = activeRoom?.room?.host_signing_public_key || '';
  if (!encoded) return null;
  if (roomGuestVerifyKey && roomGuestVerifyKeyText === encoded) return roomGuestVerifyKey;
  roomGuestVerifyKey = await crypto.subtle.importKey('spki', roomB64ToBytes(encoded), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  roomGuestVerifyKeyText = encoded;
  return roomGuestVerifyKey;
}
function roomCurrentPositionEstimate() {
  if (!roomPlayerIsPlaying) return Math.max(0, roomLastPosition);
  return Math.max(0, roomLastPosition + Math.max(0, Date.now() - roomLastPlayerTickAt) / 1000);
}
function roomSourceIndex() { return Math.max(0, Number(serverIdx) || 0); }
function roomMediaFingerprint(media) {
  if (!media) return '';
  return [media.type, media.ani_id || media.tmdb || media.tvmaze || media.imdb || '', media.episode_index || 0, media.season || 1, media.language || 'sub', media.source_index || 0].join('|');
}
async function roomSignAndBroadcast(payload) {
  if (!activeRoom || !roomIsHost() || !roomChannel || !roomRealtimeConnected) return false;
  if ((!roomHostPrivateKey || roomHostPublicKey !== (activeRoom.room.host_signing_public_key || '')) && !(await roomEnsureHostSigningKey())) return false;
  const signature = roomBytesToB64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, roomHostPrivateKey, new TextEncoder().encode(JSON.stringify(payload))));
  const result = await roomChannel.send({ type: 'broadcast', event: 'room_event', payload: { ...payload, signature } });
  return result === 'ok' || result?.status === 'ok';
}
async function roomVerifyHostBroadcast(payload) {
  if (!activeRoom || payload.host_account_id !== activeRoom.room.host_account_id || !payload.signature) return false;
  try {
    const key = await roomGetGuestVerifyKey();
    if (!key) return false;
    const { signature, ...unsigned } = payload;
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, roomB64ToBytes(signature), new TextEncoder().encode(JSON.stringify(unsigned)));
  } catch (error) { console.warn('Rejected invalid room playback signature', error); return false; }
}

async function roomApi(action, payload = {}) {
  if (!ROOM_API || !roomToken()) throw new Error('Sign in to use Watch Rooms.');
  const response = await fetch(ROOM_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: roomCfg.key, Authorization: `Bearer ${roomToken()}` },
    cache: 'no-store', credentials: 'omit', body: JSON.stringify({ action, ...payload })
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) { const error = new Error(data.error || 'Room request failed.'); error.status = response.status; throw error; }
  return data;
}

function roomMediaSnapshot() {
  if (!current || !['anime', 'movie', 'tv'].includes(current.type)) return null;
  return {
    type: current.type,
    title: String(current.title || $('mediaTitle')?.textContent || 'Untitled').slice(0, 240),
    ani_id: Number(current.ani_id || current.openedId) || 0,
    mal_id: Number(current.mal_id) || 0,
    tmdb: Number(current.tmdb) || 0,
    imdb: String(current.imdb || ''),
    tvmaze: Number(current.tvmaze) || 0,
    episodes: Number(current.episodes) || 0,
    episode_index: Number(epIndex) || 0,
    season: Number(season) || 1,
    language: String(current.effectiveLang || lang || 'sub'),
    source_index: roomSourceIndex(),
    source_name: (current.type === 'anime' ? ANIME_SERVERS : current.type === 'movie' ? MOVIE_SERVERS : TV_SERVERS)?.[roomSourceIndex()]?.name || 'Default',
    position_seconds: roomCurrentPositionEstimate(),
    playback_state: roomPlayerIsPlaying ? 'playing' : 'paused'
  };
}
function roomIsHost() {
  return !!(activeRoom && (activeRoom.me?.role === 'host' || (accountUser && activeRoom.room.host_account_id === accountUser.id)));
}
function roomUrl(code) { return `${location.origin}/room/${encodeURIComponent(code)}`; }
function roomPlayerPath() {
  if (typeof routeFor !== 'function' || !current) return '/';
  return routeFor({ kind: 'player', playerType: current.type, imdb: current.imdb || '', tmdb: current.tmdb || 0,
    tvmaze: current.tvmaze || 0, aniId: current.ani_id || current.openedId || 0, malId: current.mal_id || 0,
    title: current.title || $('mediaTitle')?.textContent || 'watch' });
}
function roomSetAddress(path) { try { history.replaceState(history.state, '', path || '/'); } catch (_) {} }

function roomSetPlayerAccess() {
  const lock = roomEl('roomPlayerLock');
  const guestLocked = !!activeRoom && !roomIsHost();
  if (lock) { lock.hidden = !guestLocked; lock.setAttribute('aria-hidden', String(!guestLocked)); }
  ['epToggle', 'nextBtn', 'autoNextToggle', 'nextUp', 'serverLabel', 'serverRow', 'playerControls', 'animeSeasons'].forEach(id => {
    const element = roomEl(id);
    if (!element) return;
    if (guestLocked) {
      if (!element.dataset.roomOriginalDisplay) element.dataset.roomOriginalDisplay = element.style.display || '';
      element.style.display = 'none';
    } else if (element.dataset.roomOriginalDisplay !== undefined) {
      element.style.display = element.dataset.roomOriginalDisplay;
      delete element.dataset.roomOriginalDisplay;
    }
  });
  const frame = roomEl('player');
  if (frame) {
    if (guestLocked) {
      if (frame.dataset.roomPointerEvents === undefined) frame.dataset.roomPointerEvents = frame.style.pointerEvents || '';
      if (frame.dataset.roomAllow === undefined) frame.dataset.roomAllow = frame.getAttribute('allow') || '';
      if (frame.dataset.roomFullscreen === undefined) frame.dataset.roomFullscreen = frame.hasAttribute('allowfullscreen') ? '1' : '0';
      if (frame.dataset.roomTabIndex === undefined) frame.dataset.roomTabIndex = frame.getAttribute('tabindex') === null ? '__none__' : frame.getAttribute('tabindex');
      frame.style.pointerEvents = 'none';
      frame.setAttribute('tabindex', '-1');
      frame.setAttribute('allow', frame.dataset.roomAllow.split(';').filter(item => !['fullscreen','picture-in-picture'].includes(item.trim().toLowerCase())).join(';'));
      frame.removeAttribute('allowfullscreen');
    } else {
      if (frame.dataset.roomPointerEvents !== undefined) { frame.style.pointerEvents = frame.dataset.roomPointerEvents; delete frame.dataset.roomPointerEvents; }
      if (frame.dataset.roomAllow !== undefined) { frame.setAttribute('allow', frame.dataset.roomAllow); delete frame.dataset.roomAllow; }
      if (frame.dataset.roomFullscreen !== undefined) { if (frame.dataset.roomFullscreen === '1') frame.setAttribute('allowfullscreen', ''); else frame.removeAttribute('allowfullscreen'); delete frame.dataset.roomFullscreen; }
      if (frame.dataset.roomTabIndex !== undefined) { if (frame.dataset.roomTabIndex === '__none__') frame.removeAttribute('tabindex'); else frame.setAttribute('tabindex', frame.dataset.roomTabIndex); delete frame.dataset.roomTabIndex; }
    }
    if (guestLocked && document.activeElement === frame) frame.blur();
  }
}
function roomPanelPinned() {
  const panel = roomEl('roomPanel');
  return !!panel && panel.classList.contains('room-sheet-open');
}
function roomToggleChatSheet(open) {
  const panel = roomEl('roomPanel');
  if (!panel || panel.hidden) return;
  const target = typeof open === 'boolean' ? open : !roomPanelPinned();
  panel.classList.toggle('room-sheet-open', target);
  const view = roomEl('playerView');
  if (target) {
    if (view && panel.parentElement !== view) view.appendChild(panel);
    const chat = roomEl('roomChatMessages');
    if (chat) chat.scrollTop = chat.scrollHeight;
    document.body.classList.add('room-sheet-open');
    const expand = roomEl('roomChatExpand'), close = roomEl('roomSheetClose');
    if (expand) expand.hidden = true;
    if (close) close.hidden = false;
  } else {
    document.body.classList.remove('room-sheet-open');
    roomPlacePanel(true);
  }
  roomKeyboardAnchor();
}
function roomKeyboardFrame() {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
}
function roomKeyboardAnchor() {
  const panel = roomEl('roomPanel');
  if (!panel || !panel.classList.contains('room-sheet-open')) { if (panel) panel.style.bottom = ''; return; }
  const frame = roomKeyboardFrame();
  panel.style.bottom = frame ? `${frame}px` : '';
}
function roomPlacePanel(show) {
  const panel = roomEl('roomPanel');
  if (!panel || !show) return;
  if (roomPanelPinned()) {
    const view = roomEl('playerView');
    if (view && panel.parentElement !== view) view.appendChild(panel);
    panel.classList.remove('room-mobile-overlay');
    panel.style.bottom = '';
    return;
  }
  const side = document.querySelector('#playerView .player-side');
  const video = roomEl('videoWrap');
  const mobile = window.matchMedia && window.matchMedia('(max-width: 860px)').matches;
  const target = mobile ? video : side;
  if (target && panel.parentElement !== target) target.appendChild(panel);
  panel.classList.toggle('room-mobile-overlay', mobile);
  // The expand/close sheet buttons are hidden-attribute driven (site CSS marks
  // [hidden] !important, so these cannot be styled into visibility).
  const expand = roomEl('roomChatExpand'), close = roomEl('roomSheetClose');
  if (expand) expand.hidden = !mobile;
  if (close) close.hidden = true;
}
function roomSetPanel(show) {
  const panel = roomEl('roomPanel'), layout = document.querySelector('#playerView .player-layout'), side = document.querySelector('#playerView .player-side');
  roomPlacePanel(show);
  if (panel) panel.hidden = !show;
  if (layout) layout.classList.toggle('room-active', !!show);
  if (side) side.classList.toggle('room-active', !!show);
  const episodes = roomEl('epPanel'), upNext = document.querySelector('#playerView .up-next');
  if (episodes) episodes.hidden = !!show;
  if (upNext) upNext.hidden = !!show;
  if (show) roomPrepareChat();
  roomSetPlayerAccess();
}

function roomHue(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 360;
}
function roomAvatarStyle(name) {
  const h = roomHue(name || 'A');
  return `background:hsl(${h},26%,24%);color:hsl(${h},58%,78%)`;
}
function roomRenderMembers() {
  const count = roomEl('roomMemberCount'); if (count) count.textContent = `${activeRoom.members.length}/4`;
  const list = roomEl('roomMemberList');
  if (list) {
    list.innerHTML = activeRoom.members.map(member => {
      const isSelf = member.account_id === accountUser?.id;
      const isHost = member.role === 'host';
      return `<div class="room-member${isHost ? ' is-host' : ''}${isSelf ? ' is-self' : ''}" title="${roomEsc(member.name)}${isHost ? ' · Host' : isSelf ? ' · You' : ''}"><span class="room-member-avatar" style="${roomAvatarStyle(member.name)}">${roomEsc((member.name || 'A').slice(0, 1).toUpperCase())}</span><span class="room-member-name">${roomEsc(member.name)}${isSelf ? ' <b>(you)</b>' : ''}</span>${isHost ? '<span class="room-host-badge"><i class="ri-vip-crown-2-fill" aria-hidden="true"></i></span>' : ''}</div>`;
    }).join('');
  }
  const host = activeRoom.members.find(member => member.role === 'host');
  const status = roomEl('roomPlaybackStatus');
  if (status) status.textContent = roomIsHost() ? 'Your player controls the room' : `${host?.name || 'The host'} controls playback`;
  const note = roomEl('roomProviderNote'); if (note) note.hidden = roomIsHost();
  const endButton = roomEl('roomEndButton'); if (endButton) endButton.hidden = !roomIsHost();
  const localVolume = roomEl('roomLocalVolumeControl'); if (localVolume) localVolume.hidden = roomIsHost();
  const volumeRange = roomEl('roomLocalVolumeRange'); if (volumeRange) volumeRange.value = String(Math.round(roomLocalVolume * 100));
  const volumeValue = roomEl('roomLocalVolumeValue'); if (volumeValue) volumeValue.textContent = `${Math.round(roomLocalVolume * 100)}%`;
  const createButton = roomEl('createRoomButton'); if (createButton) createButton.hidden = !!activeRoom;
  roomSetPlayerAccess();
}
function roomConnMark(text) {
  const pill = roomEl('roomLivePill'), label = roomEl('roomConnection');
  if (label) label.textContent = text;
  if (pill) pill.dataset.state = text === 'Live' ? 'live' : 'wait';
}
function roomDayLabel(date) {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
const ROOM_GROUP_WINDOW = 3 * 60 * 1000;
function roomMessageMarkup(message, prev) {
  const mine = message.sender_account_id === accountUser?.id, name = message.name || 'AnimeStream member';
  const at = new Date(message.created_at);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let html = '';
  if (prev && new Date(prev.created_at).toDateString() !== at.toDateString()) {
    html += `<div class="room-msg-day"><span>${roomEsc(roomDayLabel(at))} · ${roomEsc(time)}</span></div>`;
  }
  const grouped = !!prev && prev.sender_account_id === message.sender_account_id
    && new Date(prev.created_at).toDateString() === at.toDateString()
    && (at - new Date(prev.created_at)) < ROOM_GROUP_WINDOW;
  html += `<div class="room-message${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}" data-message-id="${roomEsc(message.id)}"><span class="room-msg-avatar" style="${roomAvatarStyle(name)}" aria-hidden="true">${roomEsc(name.slice(0, 1).toUpperCase())}</span><div class="room-msg-content"><div class="room-msg-meta"><strong title="${roomEsc(at.toLocaleString())}">${roomEsc(name)}</strong><time>${roomEsc(time)}</time></div><p>${roomEsc(message.body)}</p></div></div>`;
  return html;
}
let roomChatUnread = 0;
function roomChatResetUnread() {
  roomChatUnread = 0;
  const pill = roomEl('roomChatJump'); if (pill) pill.hidden = true;
  const n = roomEl('roomChatJumpN'); if (n) n.textContent = '';
}
function roomChatBumpUnread() {
  roomChatUnread++;
  const pill = roomEl('roomChatJump'), n = roomEl('roomChatJumpN');
  if (pill) pill.hidden = false;
  if (n) n.textContent = roomChatUnread > 49 ? '49+' : String(roomChatUnread);
}
function roomChatJumpToLatest() {
  const chat = roomEl('roomChatMessages'); if (!chat) return;
  chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
  roomChatResetUnread();
}
function roomPrepareChat() {
  const chat = roomEl('roomChatMessages');
  if (chat && !chat.dataset.roomScrollInit) {
    chat.dataset.roomScrollInit = '1';
    chat.addEventListener('scroll', () => {
      const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 64;
      if (atBottom) roomChatResetUnread();
    });
  }
}
function roomRenderMessages(messages, forceBottom = false) {
  const chat = roomEl('roomChatMessages'); if (!chat) return;
  const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90;
  const list = messages || [];
  let html = '', prev = null;
  for (const message of list) { html += roomMessageMarkup(message, prev); prev = message; }
  chat.innerHTML = html || '<div class="room-chat-empty"><i class="ri-chat-3-line" aria-hidden="true"></i><b>No messages yet</b><span>Chat with your room while you watch.</span></div>';
  if (forceBottom || atBottom) chat.scrollTop = chat.scrollHeight;
  roomSeenMessages = new Set(list.map(message => message.id));
  if (forceBottom || atBottom) roomChatResetUnread();
}
function roomAppendMessage(message) {
  if (!activeRoom || !message || roomSeenMessages.has(message.id)) return;
  const chat = roomEl('roomChatMessages'); if (!chat) return;
  const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 110;
  if (!roomSeenMessages.size && chat.querySelector('.room-chat-empty')) chat.innerHTML = '';
  const prev = activeRoom.messages?.length ? activeRoom.messages[activeRoom.messages.length - 1] : null;
  chat.insertAdjacentHTML('beforeend', roomMessageMarkup(message, prev));
  roomSeenMessages.add(message.id);
  if (activeRoom.messages) activeRoom.messages.push(message);
  if (activeRoom.messages?.length > 60) activeRoom.messages.shift();
  if (atBottom) { chat.scrollTop = chat.scrollHeight; roomChatResetUnread(); }
  else roomChatBumpUnread();
}
function roomRender(data, options = {}) {
  if (!activeRoom || !data) return;
  const incomingRevision = Number(data.room?.revision) || 0;
  // A heartbeat/snapshot may have started before a newer Realtime event arrived.
  // Never let that older response roll back a freshly received playback command.
  if (incomingRevision < roomLastRevision) return;
  const oldTopic = activeRoom.room.topic;
  const oldPlaybackUpdatedAt = activeRoom.room.playback_updated_at;
  const previousRoom = activeRoom.room;
  const incomingPlaybackSeq = Number(data.room.playback_seq) || 0;
  const preserveLivePlayback = incomingPlaybackSeq < roomLastHostSequence;
  const wasHost = roomIsHost();
  activeRoom.room = { ...data.room };
  if (preserveLivePlayback) {
    activeRoom.room.media = previousRoom.media;
    activeRoom.room.playback_state = previousRoom.playback_state;
    activeRoom.room.position_seconds = previousRoom.position_seconds;
    activeRoom.room.playback_updated_at = previousRoom.playback_updated_at;
    activeRoom.room.playback_seq = roomPlaybackSeq;
  }
  activeRoom.members = data.members || []; activeRoom.messages = data.messages || []; activeRoom.me = data.me;
  if (roomGuestVerifyKeyText !== (data.room.host_signing_public_key || '')) { roomGuestVerifyKey = null; roomGuestVerifyKeyText = ''; }
  if (!wasHost && roomIsHost()) roomEnsureHostSigningKey().then(() => roomStartHostStateStream()).catch(error => roomToast(error.message));
  roomLastRevision = Math.max(roomLastRevision, incomingRevision);
  roomLastPlaybackRevision = Math.max(roomLastPlaybackRevision, incomingRevision);
  roomPlaybackSeq = Math.max(roomPlaybackSeq, Number(data.room.playback_seq) || 0);
  roomLastHostSequence = Math.max(roomLastHostSequence, Number(data.room.playback_seq) || 0);
  roomLastPlaybackUpdatedAt = data.room.playback_updated_at || roomLastPlaybackUpdatedAt;
  const code = roomEl('roomCode'); if (code) code.textContent = activeRoom.room.code;
  roomRenderMembers(); roomRenderMessages(activeRoom.messages, !!options.forceChatBottom);
  if (!roomIsHost() && (options.applyPlayback || activeRoom.room.playback_updated_at !== oldPlaybackUpdatedAt)) roomApplyPlaybackSnapshot(activeRoom.room, !!options.applyPlayback);
  if (oldTopic && oldTopic !== activeRoom.room.topic) roomConnect(data);
}

async function roomFetch() {
  if (!activeRoom) return;
  try { const data = await roomApi('get_room', { room_id: activeRoom.room.id }); roomRender(data); }
  catch (error) { if ([403,404,410].includes(error.status)) roomFinishLocally('This room has ended or you have left it.'); }
}
function roomStartPolling() { if (!roomPollTimer && activeRoom) roomPollTimer = setInterval(roomFetch, ROOM_POLL_MS); }
function roomStopPolling() { clearInterval(roomPollTimer); roomPollTimer = null; }
function roomScheduleRefresh() { clearTimeout(roomRefreshTimer); roomRefreshTimer = setTimeout(roomFetch, 80); }
function roomScheduleReconnect() {
  if (!activeRoom || roomRealtimeConnected || roomReconnectTimer) return;
  roomReconnectTimer = setTimeout(() => {
    roomReconnectTimer = null;
    if (activeRoom && !roomRealtimeConnected) roomConnect(activeRoom);
  }, 3000);
}
function roomHandleBroadcastFailure(reason) {
  console.warn('Room Realtime broadcast unavailable; switching to recovery polling', reason || 'unknown error');
  roomRealtimeConnected = false;
  roomConnMark('Reconnecting');
  roomStartPolling(); roomSendProgress(true); roomScheduleReconnect();
}
async function roomHandleRealtime(event) {
  const p = event?.payload || event || {};
  if (!activeRoom || (p.room_id && p.room_id !== activeRoom.room.id)) return;
  if (p.kind === 'room_ended') { roomFinishLocally('The host ended this room.'); return; }
  if (p.kind === 'message' && p.message) {
    roomLastRevision = Math.max(roomLastRevision, Number(p.revision) || 0);
    roomAppendMessage(p.message);
    return;
  }
  if (p.kind === 'host_state' || p.kind === 'host_playback') {
    if (roomIsHost() || !(await roomVerifyHostBroadcast(p))) return;
    const sequence = Number(p.playback_seq) || 0;
    if (!sequence || sequence <= roomLastHostSequence) return;
    roomLastHostSequence = sequence;
    roomPlaybackSeq = Math.max(roomPlaybackSeq, sequence);
    if (p.kind === 'host_playback') await roomApplyHostPlayback(p);
    else await roomApplyHostState(p);
    return;
  }
  const revision = Number(p.revision) || 0;
  if (revision > 0) roomLastRevision = Math.max(roomLastRevision, revision);
  if (['member_changed', 'host_changed', 'host_key_changed'].includes(p.kind)) {
    if (p.kind === 'member_changed' && roomIsHost()) roomBroadcastHostState(true);
    roomScheduleRefresh();
  }
}

async function roomConnect(snapshot) {
  const status = roomEl('roomConnection'); roomConnMark('Connecting…'); roomRealtimeConnected = false; roomStopPolling(); clearInterval(roomHeartbeatTimer);
  roomHeartbeatTimer = setInterval(roomHeartbeat, 12000);
  if (!window.supabase?.createClient) { if (status) status.textContent = 'Connecting…'; roomStartPolling(); return; }
  try {
    if (!roomRt) roomRt = window.supabase.createClient(roomCfg.url, roomCfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    if (roomChannel) { try { await roomRt.removeChannel(roomChannel); } catch (_) {} roomChannel = null; }
    roomChannelTopic = snapshot.room.topic;
    roomChannel = roomRt.channel(roomChannelTopic, { config: { private: false, broadcast: { self: false } } })
      .on('broadcast', { event: 'room_event' }, roomHandleRealtime)
      .subscribe(state => {
        if (state === 'SUBSCRIBED') {
          roomRealtimeConnected = true; clearTimeout(roomReconnectTimer); roomReconnectTimer = null;
          roomStopPolling(); roomConnMark('Live');
          if (roomIsHost()) roomStartHostStateStream();
          roomFetch();
        } else {
          roomRealtimeConnected = false; roomConnMark('Reconnecting'); roomStartPolling();
          if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(state)) roomScheduleReconnect();
        }
      });
    setTimeout(() => {
      if (activeRoom && roomChannel && roomChannelTopic === snapshot.room.topic && !roomRealtimeConnected) {
        roomStartPolling(); roomConnMark('Reconnecting'); roomScheduleReconnect();
      }
    }, 3500);
  } catch (error) { console.warn('Realtime unavailable; using authenticated polling', error?.message || error); roomConnMark('Reconnecting'); roomStartPolling(); }
}
async function roomHeartbeat() {
  if (!activeRoom) return;
  try { const data = await roomApi('heartbeat', { room_id: activeRoom.room.id }); if (data?.room) roomRender(data); }
  catch (error) { if ([403,404,410].includes(error.status)) roomFinishLocally('This room has ended or you have left it.'); }
}

async function roomActivate(data, { openMedia = false } = {}) {
  if (!data?.room) throw new Error('The room data could not be loaded.');
  activeRoom = data; roomLastRevision = Number(data.room.revision) || 0; roomLastPlaybackRevision = Number(data.room.revision) || 0; roomPlaybackSeq = Number(data.room.playback_seq) || 0; roomLastHostSequence = Number(data.room.playback_seq) || 0;
  roomLastPlaybackUpdatedAt = data.room.playback_updated_at || '';
  roomLastPosition = Number(data.room.position_seconds) || 0;
  roomLastPlayerTickAt = Date.now();
  roomLastPlaybackAdvanceAt = roomLastPlayerTickAt;
  roomPlayerIsPlaying = data.room.playback_state === 'playing'; roomExplicitPauseAt = roomPlayerIsPlaying ? 0 : Date.now(); roomStationaryHostTicks = 0; roomLastGuestPauseCommandAt = 0; roomSeenMessages = new Set();
  roomSetPanel(true); roomSetAddress(roomUrl(data.room.code)); showPlayer();
  roomRender(data, { forceChatBottom: true });
  if (roomIsHost()) await roomEnsureHostSigningKey();
  else await roomGetGuestVerifyKey().catch(() => null);
  await roomConnect(data);
  if (openMedia) { roomApplying = true; try { await roomOpenMedia(data.room.media); } finally { roomApplying = false; } }
  if (!roomIsHost()) roomApplyPlaybackSnapshot(data.room, true);
  roomToast(`Joined room ${data.room.code}.`);
}
async function createWatchRoom() {
  if (!accountUser) { window.pendingRoomCreate = true; openLogin(); return; }
  const media = roomMediaSnapshot(); if (!media) { roomToast('Open an anime, movie or series first.'); return; }
  try {
    const signingPair = await roomCreateHostKeyPair();
    const data = await roomApi('create_room', { media, host_signing_public_key: signingPair.publicKey });
    try { sessionStorage.setItem(roomHostKeyStorageName(data.room.id), JSON.stringify({ publicKey: signingPair.publicKey, privateKey: signingPair.privateKey })); }
    catch (_) {
      try { await roomApi('end_room', { room_id: data.room.id }); } catch (_) {}
      throw new Error('This browser could not store the secure room key. Please allow session storage and try again.');
    }
    roomHostPrivateKey = signingPair.importedPrivateKey;
    roomHostPublicKey = signingPair.publicKey;
    await roomActivate(data);
    roomToast('Room created. Invite up to 3 friends.');
  } catch (error) { roomToast(error.message || 'Could not create room.'); }
}
async function joinWatchRoom(code) {
  if (!accountUser) { roomPendingCode = String(code || '').toUpperCase(); window.pendingRoomCode = roomPendingCode; openLogin(); return; }
  try { const data = await roomApi('join_room', { code }); await roomActivate(data, { openMedia: true }); }
  catch (error) { roomToast(error.message || 'Could not join room.'); }
}
async function roomBoot(code) {
  const invite = String(code || '').toUpperCase(); roomPendingCode = invite; window.pendingRoomCode = invite;
  await (window.accountReady || Promise.resolve(false));
  if (!accountUser) { openLogin(); return; }
  window.pendingRoomCode = ''; roomPendingCode = ''; await joinWatchRoom(invite);
}
window.roomBoot = roomBoot;
window.roomsResumePending = () => {
  if (window.pendingRoomCode) { const code = window.pendingRoomCode; window.pendingRoomCode = ''; roomPendingCode = ''; joinWatchRoom(code).catch(error => roomToast(error.message)); }
  else if (window.pendingRoomCreate) { window.pendingRoomCreate = false; createWatchRoom(); }
};
function openJoinRoom() { const modal = roomEl('joinRoomModal'); if (!accountUser) { openLogin(); return; } if (modal) { modal.hidden = false; setTimeout(() => roomEl('joinRoomCode')?.focus(), 40); } }
function closeJoinRoom() { const modal = roomEl('joinRoomModal'); if (modal) modal.hidden = true; }
async function submitJoinRoom(event) {
  if (event) event.preventDefault();
  const code = String(roomEl('joinRoomCode')?.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) { roomToast('Enter the 8-character room code.'); return false; }
  closeJoinRoom(); await joinWatchRoom(code); return false;
}
async function roomShare() {
  if (!activeRoom) return; const url = roomUrl(activeRoom.room.code);
  try { await navigator.clipboard.writeText(url); roomToast('Room invite link copied.'); }
  catch (_) { window.prompt('Copy this room invite link:', url); }
}
async function roomCopyCode() {
  if (!activeRoom) return; const code = activeRoom.room.code;
  try { await navigator.clipboard.writeText(code); roomToast('Room code copied.'); }
  catch (_) { window.prompt('Copy this room code:', code); }
}
async function roomSendMessage(event) {
  if (event) event.preventDefault(); if (!activeRoom) return false;
  const input = roomEl('roomChatInput'), body = String(input?.value || '').trim();
  if (!body) return false; if (body.length > 500) { roomToast('Messages must be 500 characters or fewer.'); return false; }
  if (input) input.value = '';
  try { const result = await roomApi('send_message', { room_id: activeRoom.room.id, body }); roomAppendMessage(result.message); }
  catch (error) { roomToast(error.message || 'Message was not sent.'); if (input) input.value = body; }
  return false;
}

async function roomPersistPlayback(payload) {
  if (!activeRoom || !roomIsHost()) return;
  try {
    const result = await roomApi('control', payload);
    roomLastRevision = Math.max(roomLastRevision, Number(result.revision) || 0);
    roomPlaybackSeq = Math.max(roomPlaybackSeq, Number(result.playback_seq) || payload.playback_seq);
    if (result.playback_updated_at) roomLastPlaybackUpdatedAt = result.playback_updated_at;
  } catch (error) { console.warn('Could not checkpoint room playback', error.message); }
}
function roomBuildHostPacket(kind, position, media = null) {
  const sentAt = Date.now();
  const positionSeconds = Math.max(0, Number(position) || 0);
  const playbackState = roomPlayerIsPlaying ? 'playing' : 'paused';
  const mediaState = { ...(media || roomMediaSnapshot() || {}), position_seconds: positionSeconds, playback_state: playbackState };
  return {
    room_id: activeRoom.room.id,
    host_account_id: activeRoom.room.host_account_id,
    kind,
    playback_seq: ++roomPlaybackSeq,
    sent_at: sentAt,
    position_seconds: positionSeconds,
    playback_state: playbackState,
    playback_rate: 1,
    media: mediaState
  };
}
async function roomSendHostControl(kind, position = roomCurrentPositionEstimate(), media = null) {
  if (!activeRoom || !roomIsHost()) return;
  roomProgressPending = null;
  if (kind === 'pause') roomPlayerIsPlaying = false;
  else if (kind === 'play') roomPlayerIsPlaying = true;
  const packet = roomBuildHostPacket('host_playback', position, media);
  packet.command = kind;
  roomLastPosition = packet.position_seconds;
  roomLastPlayerTickAt = Date.now();
  // WebSocket delivery comes first; HTTP/database persistence happens independently.
  roomSignAndBroadcast(packet).then(ok => { if (!ok) roomHandleBroadcastFailure('playback command was not accepted'); }).catch(error => roomHandleBroadcastFailure(error));
  roomPersistPlayback({ ...packet, kind, media: media || packet.media });
  roomLastHostProgressMessageAt = Date.now();
  roomArmHostPauseTimer();
}

function applyRoomPlayerCommand(action, position) {
  const frame = roomEl('player'); if (!frame?.contentWindow) return;
  const message = { type: 'ANIMESTREAM_ROOM_CONTROL', action };
  if (action === 'volume') message.volume = Math.max(0, Math.min(1, Number(position) || 0));
  else message.position_seconds = Math.max(0, Number(position) || 0);
  try { frame.contentWindow.postMessage(message, location.origin); } catch (_) {}
}
function roomApplyPauseToPlayer(position, expectedSequence = roomLastHostSequence) {
  const target = Math.max(0, Number(position) || 0);
  const roomId = activeRoom?.room?.id;
  const pauseSequence = Number(expectedSequence) || 0;
  roomPlayerIsPlaying = false;
  roomLastPosition = target;
  roomLastPlayerTickAt = Date.now();
  roomLastGuestPauseCommandAt = Date.now();
  // Pause first. Reassert it after the seek in case the provider processes seek
  // asynchronously or the seek operation briefly resumes playback.
  applyRoomPlayerCommand('pause', target);
  setTimeout(() => {
    if (!activeRoom || activeRoom.room.id !== roomId || roomIsHost()) return;
    // A later Play/Seek packet supersedes this delayed pause reassertion.
    if (pauseSequence && roomLastHostSequence !== pauseSequence) return;
    applyRoomPlayerCommand('seek', target);
    applyRoomPlayerCommand('pause', target);
    roomLastGuestPauseCommandAt = Date.now();
  }, 140);
}
function roomSetLocalVolume(value) {
  roomLocalVolume = Math.max(0, Math.min(1, Number(value) || 0));
  const label = roomEl('roomLocalVolumeValue'); if (label) label.textContent = `${Math.round(roomLocalVolume * 100)}%`;
  if (activeRoom && !roomIsHost()) applyRoomPlayerCommand('volume', roomLocalVolume);
}
window.roomSetLocalVolume = roomSetLocalVolume;
function roomApplyPlaybackSnapshot(room, force = false) {
  if (!activeRoom || roomIsHost()) return;
  const media = room.media || {}, local = roomMediaSnapshot();
  const same = local && local.type === media.type && String(local.ani_id || local.tmdb || local.tvmaze || local.imdb) === String(media.ani_id || media.tmdb || media.tvmaze || media.imdb) && Number(local.episode_index || 0) === Number(media.episode_index || 0) && Number(local.season || 1) === Number(media.season || 1) && Number(local.source_index || 0) === Number(media.source_index || 0) && String(local.language || 'sub') === String(media.language || 'sub');
  if (!same) { roomApplying = true; roomOpenMedia(media).finally(() => { roomApplying = false; roomApplyPlaybackSnapshot(room, true); }); return; }
  const updatedAt = Date.parse(room.playback_updated_at || '') || Date.now();
  const target = Math.max(0, Number(room.position_seconds || 0) + (room.playback_state === 'playing' ? (Date.now() - updatedAt) / 1000 : 0));
  if (force || Math.abs(roomLastPosition - target) > 1.2) { roomLastPosition = target; applyRoomPlayerCommand('seek', target); }
  const shouldPlay = room.playback_state === 'playing';
  if (force || roomPlayerIsPlaying !== shouldPlay) {
    if (shouldPlay) {
      roomPlayerIsPlaying = true;
      roomLastPlaybackAdvanceAt = Date.now();
      applyRoomPlayerCommand('play', target);
    } else {
      roomApplyPauseToPlayer(target);
    }
  }
}
async function roomApplyHostMedia(media) {
  if (!activeRoom || !media) return;
  if (roomMediaFingerprint(roomMediaSnapshot()) !== roomMediaFingerprint(media)) {
    roomApplying = true;
    try { await roomOpenMedia(media); }
    finally { roomApplying = false; }
    roomLastPosition = Math.max(0, Number(media.position_seconds) || 0);
    roomLastPlayerTickAt = Date.now();
    roomLastPlaybackAdvanceAt = roomLastPlayerTickAt;
  }
}
async function roomApplyHostPlayback(payload) {
  if (!activeRoom || roomIsHost()) return;
  if (payload.media) await roomApplyHostMedia(payload.media);
  const state = payload.playback_state || (payload.command === 'play' ? 'playing' : payload.command === 'pause' ? 'paused' : activeRoom.room.playback_state);
  const target = Math.max(0, Number(payload.position_seconds) || 0);
  activeRoom.room.playback_state = state;
  activeRoom.room.position_seconds = target;
  activeRoom.room.playback_updated_at = new Date(Number(payload.sent_at) || Date.now()).toISOString();
  if (payload.command === 'pause' || state === 'paused') {
    roomApplyPauseToPlayer(target, Number(payload.playback_seq) || roomLastHostSequence);
  } else if (['play', 'seek', 'episode'].includes(payload.command)) {
    roomLastPosition = target;
    roomLastPlayerTickAt = Date.now();
    roomLastPlaybackAdvanceAt = roomLastPlayerTickAt;
    applyRoomPlayerCommand('seek', target);
    roomPlayerIsPlaying = true;
    applyRoomPlayerCommand('play', target);
  }
}
async function roomApplyHostState(payload) {
  if (!activeRoom || roomIsHost()) return;
  if (payload.media && roomMediaFingerprint(roomMediaSnapshot()) !== roomMediaFingerprint(payload.media)) await roomApplyHostMedia(payload.media);
  const state = payload.playback_state === 'playing' ? 'playing' : 'paused';
  const rate = Math.max(0.5, Math.min(2, Number(payload.playback_rate) || 1));
  const sentAt = Number(payload.sent_at) || Date.now();
  const target = Math.max(0, Number(payload.position_seconds) || 0) + (state === 'playing' ? Math.max(0, Date.now() - sentAt) / 1000 * rate : 0);
  const expectedWasPlaying = activeRoom.room.playback_state === 'playing';
  const guestPlaybackStalled = state === 'playing' && expectedWasPlaying && Date.now() - roomLastPlaybackAdvanceAt > 1800;
  if (guestPlaybackStalled) roomPlayerIsPlaying = false;
  const actual = roomPlayerIsPlaying ? roomCurrentPositionEstimate() : roomLastPosition;
  const drift = target - actual;
  const stateChanged = state !== (activeRoom.room.playback_state || 'paused');
  if (state === 'paused') {
    if (stateChanged || roomPlayerIsPlaying || Date.now() - roomLastGuestPauseCommandAt >= ROOM_GUEST_PAUSE_RETRY_MS) {
      roomApplyPauseToPlayer(target, Number(payload.playback_seq) || roomLastHostSequence);
    } else {
      roomPlayerIsPlaying = false;
    }
  } else {
    const needsStart = !roomPlayerIsPlaying && Date.now() - roomLastGuestPlayCommandAt >= 1500;
    if (stateChanged || needsStart) {
      if (Math.abs(drift) > ROOM_DRIFT_TOLERANCE) { applyRoomPlayerCommand('seek', target); roomLastPosition = target; roomLastPlayerTickAt = Date.now(); }
      applyRoomPlayerCommand('play', target);
      roomLastGuestPlayCommandAt = Date.now();
      roomLastPlaybackAdvanceAt = Date.now();
      roomPlayerIsPlaying = true;
    } else if (Math.abs(drift) >= ROOM_DRIFT_SEEK_THRESHOLD && Date.now() - roomLastCorrectionAt >= 1800) {
      roomLastCorrectionAt = Date.now();
      roomLastPosition = target; roomLastPlayerTickAt = Date.now();
      applyRoomPlayerCommand('seek', target);
    }
  }
  activeRoom.room.media = payload.media || activeRoom.room.media;
  activeRoom.room.playback_state = state;
  activeRoom.room.position_seconds = Number(payload.position_seconds) || 0;
  activeRoom.room.playback_seq = Number(payload.playback_seq) || activeRoom.room.playback_seq;
  activeRoom.room.playback_updated_at = new Date(sentAt).toISOString();
  roomLastPlaybackUpdatedAt = activeRoom.room.playback_updated_at;
}

let roomProgressInFlight = false;
let roomProgressPending = null;
async function roomSendProgress(force = false) {
  if (!activeRoom || !roomIsHost() || (!roomPlayerIsPlaying && !force)) return;
  const now = Date.now();
  if (!force && now - roomLastPersistAt < ROOM_PROGRESS_MS) return;
  roomLastPersistAt = now;
  const payload = {
    room_id: activeRoom.room.id, kind: 'position',
    position_seconds: roomCurrentPositionEstimate(),
    playback_state: roomPlayerIsPlaying ? 'playing' : 'paused',
    playback_seq: roomPlaybackSeq
  };
  roomApi('progress', payload).then(result => {
    roomLastRevision = Math.max(roomLastRevision, Number(result.revision) || 0);
    roomPlaybackSeq = Math.max(roomPlaybackSeq, Number(result.playback_seq) || roomPlaybackSeq);
    if (result.playback_updated_at) roomLastPlaybackUpdatedAt = result.playback_updated_at;
  }).catch(error => {
    if (error.status === 403 || error.status === 410) roomFinishLocally('Your host session is no longer active.');
    else console.warn('Room playback checkpoint failed', error.message);
  });
}
async function roomBroadcastHostState(force = false) {
  if (!activeRoom || !roomIsHost()) return;
  const now = Date.now();
  const interval = roomPlayerIsPlaying ? ROOM_STATE_PLAYING_MS : ROOM_STATE_PAUSED_MS;
  if (!force && now - roomLastStateBroadcastAt < interval) return;
  roomLastStateBroadcastAt = now;
  const packet = roomBuildHostPacket('host_state', roomCurrentPositionEstimate());
  if (roomRealtimeConnected) roomSignAndBroadcast(packet).then(ok => { if (!ok) roomHandleBroadcastFailure('host state was not accepted'); }).catch(error => roomHandleBroadcastFailure(error));
  // Realtime is the live transport. Write a recovery checkpoint only every five seconds.
  if (now - roomLastPersistAt >= ROOM_PROGRESS_MS) roomSendProgress(true);
}
function roomStartHostStateStream() {
  if (!activeRoom || !roomIsHost() || roomStateStreamTimer) return;
  roomLastStateBroadcastAt = 0;
  roomStateStreamTimer = setInterval(roomBroadcastHostState, 250);
  roomBroadcastHostState();
}
function roomStopHostStateStream() { clearInterval(roomStateStreamTimer); roomStateStreamTimer = null; }

async function roomOpenMedia(media) {
  if (!media) return;
  const desiredServer = Math.max(0, Number(media.source_index) || 0);
  if (media.type === 'anime') {
    if (media.language === 'sub' || media.language === 'dub') { lang = media.language; try { localStorage.setItem('animestream.lang', lang); } catch (_) {} }
    await openAnime(Number(media.ani_id) || 0, Number(media.mal_id) || 0, media.title, Number(media.episodes) || 12, true);
    if (desiredServer !== Number(serverIdx)) setServer(desiredServer);
    await playAnime(Math.max(0, Number(media.episode_index) || 0));
  } else if (media.type === 'movie') {
    openMovie(Number(media.tmdb) || 0, String(media.imdb || ''), media.title, true);
    if (desiredServer !== Number(serverIdx)) setServer(desiredServer);
  } else if (media.type === 'tv') {
    await openTv(String(media.imdb || ''), String(media.tvmaze || ''), media.title, true);
    if (Number(media.season) > 0 && Number(media.season) !== Number(season)) setSeason(Number(media.season));
    if (desiredServer !== Number(serverIdx)) setServer(desiredServer);
    playTv(Math.max(0, Number(media.episode_index) || 0));
  }
}
function roomCanonicalizePlayerUrl() { roomSetAddress(roomPlayerPath()); }
function roomFinishLocally(message) { roomDisconnect(false); roomCanonicalizePlayerUrl(); if (message) roomToast(message); }
async function roomLeave(end = false) {
  if (!activeRoom) return;
  const roomId = activeRoom.room.id, button = end ? roomEl('roomEndButton') : null;
  if (button) { button.disabled = true; button.textContent = 'Ending…'; }
  try { await roomApi(end ? 'end_room' : 'leave_room', { room_id: roomId }); }
  catch (error) { if (button) { button.disabled = false; button.textContent = 'End room'; } roomToast(error.message || (end ? 'Could not end the room.' : 'Could not leave the room.')); return; }
  roomDisconnect(false); roomCanonicalizePlayerUrl(); roomToast(end ? 'Room ended. The room code and chat were deleted.' : 'You left the room. Your video is still open.');
}
async function roomDisconnect(resetUrl = false) {
  roomStopPolling(); clearInterval(roomHeartbeatTimer); clearTimeout(roomRefreshTimer); clearTimeout(roomReconnectTimer); roomReconnectTimer = null; roomClearHostPauseTimer(); roomProgressPending = null; roomStopHostStateStream();
  if (roomChannel && roomRt) { try { await roomRt.removeChannel(roomChannel); } catch (_) {} }
  const closedRoomId = activeRoom?.room?.id;
  roomChannel = null; roomChannelTopic = ''; roomRealtimeConnected = false; activeRoom = null; roomHostPrivateKey = null; roomHostPublicKey = null; roomHostKeyPromise = null; roomGuestVerifyKey = null; roomGuestVerifyKeyText = ''; roomLastRevision = 0; roomLastPlaybackRevision = 0; roomPlaybackSeq = 0; roomLastHostSequence = 0; roomLastPlaybackUpdatedAt = ''; roomExplicitPauseAt = 0; roomStationaryHostTicks = 0; roomLastGuestPauseCommandAt = 0; roomSeenMessages.clear();
  if (closedRoomId) { try { sessionStorage.removeItem(roomHostKeyStorageName(closedRoomId)); } catch (_) {} }
  roomSetPanel(false);
  const createButton = roomEl('createRoomButton'); if (createButton) createButton.hidden = false;
  const endButton = roomEl('roomEndButton'); if (endButton) { endButton.hidden = true; endButton.disabled = false; endButton.textContent = 'End room'; }
  if (resetUrl) roomCanonicalizePlayerUrl();
}
function roomClearHostPauseTimer() { clearTimeout(roomHostPauseTimer); roomHostPauseTimer = null; }
function roomArmHostPauseTimer() {
  roomClearHostPauseTimer();
  if (!activeRoom || !roomIsHost() || !roomPlayerIsPlaying || document.hidden) return;
  const roomId = activeRoom.room.id;
  roomHostPauseTimer = setTimeout(() => {
    if (!activeRoom || activeRoom.room.id !== roomId || !roomIsHost() || document.hidden || !roomPlayerIsPlaying) return;
    if (Date.now() - roomLastHostProgressMessageAt >= ROOM_HOST_STALL_MS) {
      // Some providers omit an explicit pause event but stop reporting time updates.
      // Treat a sustained stall as Pause so guests don't keep playing ahead.
      roomPlayerIsPlaying = false;
      roomExplicitPauseAt = Date.now();
      roomStationaryHostTicks = 0;
      roomSendHostControl('pause', roomLastPosition);
    }
  }, ROOM_HOST_STALL_MS + 150);
}

function roomOnPlayerMessage(message) {
  if (!message) return;
  if (message.kind === 'time') {
    const previousPosition = roomLastPosition;
    const nextPosition = Math.max(0, Number(message.time) || 0);
    const delta = nextPosition - previousPosition;
    const advanced = delta > 0.12;
    const wasPlaying = roomPlayerIsPlaying;
    const tickNow = Date.now();
    roomLastPosition = nextPosition;
    roomLastPlayerTickAt = tickNow;

    if (advanced) {
      roomLastPlaybackAdvanceAt = tickNow;
      roomStationaryHostTicks = 0;
      roomLastStationaryHostTickAt = 0;
      // A final delayed timeupdate can arrive just after a Pause event. Do not
      // interpret that one packet as a fresh Play command.
      if (!roomIsHost() || !roomExplicitPauseAt || tickNow - roomExplicitPauseAt > 1600) roomPlayerIsPlaying = true;
    } else if (roomIsHost() && roomPlayerIsPlaying && tickNow - roomLastPlaybackAdvanceAt > 900 &&
               tickNow - roomLastStationaryHostTickAt > 300) {
      roomStationaryHostTicks++;
      roomLastStationaryHostTickAt = tickNow;
      if (roomStationaryHostTicks >= ROOM_HOST_STATIONARY_TICKS) {
        roomExplicitPauseAt = tickNow;
        roomPlayerIsPlaying = false;
        roomClearHostPauseTimer();
        if (activeRoom) roomSendHostControl('pause', nextPosition);
      }
    } else if (!roomIsHost() && tickNow - roomLastPlaybackAdvanceAt > 1500) {
      roomPlayerIsPlaying = false;
    }

    if (!activeRoom) return;
    if (!roomIsHost()) {
      const expected = activeRoom.room.playback_state === 'playing';
      if (!advanced && expected && tickNow - roomLastPlaybackAdvanceAt > 1800) roomPlayerIsPlaying = false;
      return;
    }
    if (advanced && !wasPlaying && (!roomExplicitPauseAt || tickNow - roomExplicitPauseAt > 1600)) {
      roomPlayerIsPlaying = true;
      roomSendHostControl('play', nextPosition);
    } else if (Math.abs(delta) > 4.5) {
      roomSendHostControl('seek', nextPosition);
    }
    if (advanced) {
      roomLastHostProgressMessageAt = tickNow;
      roomArmHostPauseTimer();
    }
    if (roomPlayerIsPlaying) roomBroadcastHostState();
    return;
  }
  if (message.kind === 'seek') {
    roomLastPosition = Math.max(0, Number(message.time) || roomLastPosition);
    roomLastPlayerTickAt = Date.now();
    if (activeRoom && roomIsHost()) roomSendHostControl('seek', roomLastPosition);
    return;
  }
  if (message.kind === 'play' || message.kind === 'pause') {
    const now = Date.now();
    if (message.time != null && Number.isFinite(Number(message.time))) roomLastPosition = Math.max(0, Number(message.time));
    roomPlayerIsPlaying = message.kind === 'play';
    roomLastPlayerTickAt = now;
    if (message.kind === 'play') {
      roomExplicitPauseAt = 0;
      roomLastPlaybackAdvanceAt = now;
      roomStationaryHostTicks = 0;
    } else {
      roomExplicitPauseAt = now;
      roomStationaryHostTicks = 0;
      roomClearHostPauseTimer();
    }
    if (activeRoom && roomIsHost()) roomSendHostControl(message.kind, roomLastPosition);
    if (roomPlayerIsPlaying) { roomLastHostProgressMessageAt = now; roomArmHostPauseTimer(); }
  }
}
function roomOnPlayerLoaded() { if (!activeRoom || roomIsHost()) return; roomSetPlayerAccess(); applyRoomPlayerCommand('volume', roomLocalVolume); if (!roomApplying) roomApplyPlaybackSnapshot(activeRoom.room, true); }

window.createWatchRoom = createWatchRoom;
window.openJoinRoom = openJoinRoom;
window.closeJoinRoom = closeJoinRoom;
window.submitJoinRoom = submitJoinRoom;
window.roomShare = roomShare;
window.roomCopyCode = roomCopyCode;
window.roomSendMessage = roomSendMessage;
window.roomLeave = roomLeave;

function roomWrapMediaAction(name) {
  const original = window[name]; if (typeof original !== 'function') return;
  window[name] = function (...args) {
    const preservePosition = name === 'setServer' || name === 'setLang';
    const previousPosition = roomCurrentPositionEstimate();
    const previousPlaying = roomPlayerIsPlaying;
    if (!roomApplying && !preservePosition) { roomLastPosition = 0; roomLastPlayerTickAt = Date.now(); roomPlayerIsPlaying = false; }
    const result = original.apply(this, args);
    if (activeRoom && roomIsHost() && !roomApplying) {
      const publish = () => {
        if (preservePosition) {
          roomLastPosition = previousPosition;
          roomLastPlayerTickAt = Date.now();
          roomPlayerIsPlaying = previousPlaying;
          applyRoomPlayerCommand('seek', previousPosition);
          if (previousPlaying) applyRoomPlayerCommand('play', previousPosition);
        }
        const media = roomMediaSnapshot();
        roomSendHostControl('episode', roomCurrentPositionEstimate(), media);
      };
      if (result && typeof result.then === 'function') result.then(() => setTimeout(publish, 220)); else setTimeout(publish, 220);
    }
    return result;
  };
}
['openAnime', 'openMovie', 'openTv', 'playAnime', 'playTv', 'setSeason', 'setAnimeSeason', 'setServer', 'setLang'].forEach(roomWrapMediaAction);


document.addEventListener('visibilitychange', () => { if (document.hidden) roomClearHostPauseTimer(); else if (activeRoom) { roomHeartbeat(); if (roomIsHost() && roomPlayerIsPlaying) { roomLastHostProgressMessageAt = Date.now(); roomArmHostPauseTimer(); } } });

window.addEventListener('resize', () => { if (activeRoom) roomSetPanel(true); });
// Expanded mobile chat sheet: keep its bottom edge pinned above the on-screen keyboard,
// and re-seat the floating overlay when the device rotates.
window.addEventListener('resize', roomKeyboardAnchor);
if (window.visualViewport) {
  const anchor = () => { roomKeyboardAnchor(); };
  window.visualViewport.addEventListener('resize', anchor);
  window.visualViewport.addEventListener('scroll', anchor);
}
window.addEventListener('orientationchange', () => setTimeout(() => {
  if (activeRoom && !roomPanelPinned()) roomPlacePanel(true);
}, 160));
