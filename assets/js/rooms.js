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

const roomCfg = window.AUTH_CONFIG || {};
const ROOM_API = roomCfg.roomsApi || (roomCfg.url ? `${roomCfg.url}/functions/v1/rooms-api` : '');
const ROOM_POLL_MS = 1500;
const ROOM_PROGRESS_MS = 3000;
const ROOM_HOST_STALL_MS = 6000;

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
    position_seconds: Math.max(0, Number(roomLastPosition) || 0),
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
      frame.setAttribute('allow', frame.dataset.roomAllow.split(';').filter(item => item.trim().toLowerCase() !== 'fullscreen').join(';'));
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
function roomSetPanel(show) {
  const panel = roomEl('roomPanel'), layout = document.querySelector('#playerView .player-layout'), side = document.querySelector('#playerView .player-side');
  if (panel) panel.hidden = !show;
  if (layout) layout.classList.toggle('room-active', !!show);
  if (side) side.classList.toggle('room-active', !!show);
  const episodes = roomEl('epPanel'), upNext = document.querySelector('#playerView .up-next');
  if (episodes) episodes.hidden = !!show;
  if (upNext) upNext.hidden = !!show;
  roomSetPlayerAccess();
}

function roomRenderMembers() {
  const count = roomEl('roomMemberCount'); if (count) count.textContent = `${activeRoom.members.length}/4`;
  const list = roomEl('roomMemberList');
  if (list) list.innerHTML = activeRoom.members.map(member => `<div class="room-member"><span class="room-member-avatar">${roomEsc((member.name || 'A').slice(0,1).toUpperCase())}</span><span>${roomEsc(member.name)}${member.account_id === accountUser?.id ? ' (you)' : ''}</span>${member.role === 'host' ? '<small>HOST</small>' : ''}</div>`).join('');
  const status = roomEl('roomPlaybackStatus');
  if (status) status.textContent = roomIsHost() ? 'Your player controls the room' : `${activeRoom.members.find(m => m.role === 'host')?.name || 'The host'} controls playback`;
  const endButton = roomEl('roomEndButton'); if (endButton) endButton.hidden = !roomIsHost();
  const createButton = roomEl('createRoomButton'); if (createButton) createButton.hidden = !!activeRoom;
  roomSetPlayerAccess();
}
function roomMessageMarkup(message) {
  const mine = message.sender_account_id === accountUser?.id, name = message.name || 'AnimeStream member';
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `<div class="room-message ${mine ? 'mine' : ''}" data-message-id="${roomEsc(message.id)}"><span class="room-msg-avatar">${roomEsc(name.slice(0,1).toUpperCase())}</span><div class="room-msg-content"><div><strong>${roomEsc(name)}</strong><time>${roomEsc(time)}</time></div><p>${roomEsc(message.body)}</p></div></div>`;
}
function roomRenderMessages(messages, forceBottom = false) {
  const chat = roomEl('roomChatMessages'); if (!chat) return;
  const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90;
  chat.innerHTML = (messages || []).map(roomMessageMarkup).join('') || '<div class="room-chat-empty">Be the first to say something 👋</div>';
  if (forceBottom || atBottom) chat.scrollTop = chat.scrollHeight;
  roomSeenMessages = new Set((messages || []).map(message => message.id));
}
function roomAppendMessage(message) {
  if (!activeRoom || !message || roomSeenMessages.has(message.id)) return;
  const chat = roomEl('roomChatMessages'); if (!chat) return;
  const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 110;
  if (!roomSeenMessages.size && chat.querySelector('.room-chat-empty')) chat.innerHTML = '';
  chat.insertAdjacentHTML('beforeend', roomMessageMarkup(message));
  roomSeenMessages.add(message.id);
  if (activeRoom.messages) activeRoom.messages.push(message);
  if (activeRoom.messages?.length > 60) activeRoom.messages.shift();
  if (atBottom) chat.scrollTop = chat.scrollHeight;
}
function roomRender(data, options = {}) {
  if (!activeRoom || !data) return;
  const incomingRevision = Number(data.room?.revision) || 0;
  // A heartbeat/snapshot may have started before a newer Realtime event arrived.
  // Never let that older response roll back a freshly received playback command.
  if (incomingRevision < roomLastRevision) return;
  const oldTopic = activeRoom.room.topic;
  const oldPlaybackUpdatedAt = activeRoom.room.playback_updated_at;
  activeRoom.room = data.room; activeRoom.members = data.members || []; activeRoom.messages = data.messages || []; activeRoom.me = data.me;
  roomLastRevision = Math.max(roomLastRevision, incomingRevision);
  roomLastPlaybackRevision = Math.max(roomLastPlaybackRevision, incomingRevision);
  roomPlaybackSeq = Math.max(roomPlaybackSeq, Number(data.room.playback_seq) || 0);
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
function roomHandleRealtime(event) {
  const p = event?.payload || event || {};
  if (!activeRoom || (p.room_id && p.room_id !== activeRoom.room.id)) return;
  if (p.kind === 'room_ended') { roomFinishLocally('The host ended this room.'); return; }
  // Chat IDs are independently de-duplicated. Chat revisions must not suppress
  // a playback command that was committed just before the message.
  if (p.kind === 'message' && p.message) {
    roomLastRevision = Math.max(roomLastRevision, Number(p.revision) || 0);
    roomAppendMessage(p.message);
    return;
  }
  const revision = Number(p.revision) || 0;
  if (['playback', 'position'].includes(p.kind)) {
    if (revision > 0 && revision <= roomLastPlaybackRevision) return;
    if (revision > 0) roomLastPlaybackRevision = revision;
    roomLastRevision = Math.max(roomLastRevision, revision);
    if (p.kind === 'playback') { roomApplyRealtimePlayback(p); return; }
    roomApplyRealtimePosition(p);
    return;
  }
  if (revision > 0) roomLastRevision = Math.max(roomLastRevision, revision);
  if (['member_changed', 'host_changed'].includes(p.kind)) roomScheduleRefresh();
}

async function roomConnect(snapshot) {
  const status = roomEl('roomConnection'); roomRealtimeConnected = false; roomStopPolling(); clearInterval(roomHeartbeatTimer);
  roomHeartbeatTimer = setInterval(roomHeartbeat, 12000);
  if (!window.supabase?.createClient) { if (status) status.textContent = 'Reconnecting'; roomStartPolling(); return; }
  try {
    if (!roomRt) roomRt = window.supabase.createClient(roomCfg.url, roomCfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    if (roomChannel) { try { await roomRt.removeChannel(roomChannel); } catch (_) {} roomChannel = null; }
    roomChannelTopic = snapshot.room.topic;
    roomChannel = roomRt.channel(roomChannelTopic, { config: { private: false, broadcast: { self: false } } })
      .on('broadcast', { event: 'room_event' }, roomHandleRealtime)
      .subscribe(state => {
        if (state === 'SUBSCRIBED') { roomRealtimeConnected = true; roomStopPolling(); if (status) status.textContent = 'Live'; roomFetch(); }
        else { roomRealtimeConnected = false; if (status) status.textContent = 'Reconnecting'; roomStartPolling(); }
      });
    setTimeout(() => {
      if (activeRoom && roomChannel && roomChannelTopic === snapshot.room.topic && !roomRealtimeConnected) {
        roomStartPolling(); if (status) status.textContent = 'Reconnecting';
      }
    }, 3500);
  } catch (error) { console.warn('Realtime unavailable; using authenticated polling', error?.message || error); if (status) status.textContent = 'Reconnecting'; roomStartPolling(); }
}
async function roomHeartbeat() {
  if (!activeRoom) return;
  try { const data = await roomApi('heartbeat', { room_id: activeRoom.room.id }); if (data?.room) roomRender(data); }
  catch (error) { if ([403,404,410].includes(error.status)) roomFinishLocally('This room has ended or you have left it.'); }
}

async function roomActivate(data, { openMedia = false } = {}) {
  if (!data?.room) throw new Error('The room data could not be loaded.');
  activeRoom = data; roomLastRevision = Number(data.room.revision) || 0; roomLastPlaybackRevision = Number(data.room.revision) || 0; roomPlaybackSeq = Number(data.room.playback_seq) || 0;
  roomLastPlaybackUpdatedAt = data.room.playback_updated_at || '';
  roomLastPosition = Number(data.room.position_seconds) || 0;
  roomPlayerIsPlaying = data.room.playback_state === 'playing'; roomSeenMessages = new Set();
  roomSetPanel(true); roomSetAddress(roomUrl(data.room.code)); showPlayer();
  roomRender(data, { forceChatBottom: true }); await roomConnect(data);
  if (openMedia) { roomApplying = true; try { await roomOpenMedia(data.room.media); } finally { roomApplying = false; } }
  if (!roomIsHost()) roomApplyPlaybackSnapshot(data.room, true);
  roomToast(`Joined room ${data.room.code}.`);
}
async function createWatchRoom() {
  if (!accountUser) { window.pendingRoomCreate = true; openLogin(); return; }
  const media = roomMediaSnapshot(); if (!media) { roomToast('Open an anime, movie or series first.'); return; }
  try { const data = await roomApi('create_room', { media }); await roomActivate(data); roomToast('Room created. Invite up to 3 friends.'); }
  catch (error) { roomToast(error.message || 'Could not create room.'); }
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

function roomQueueAction(action) { roomControlQueue = roomControlQueue.catch(() => {}).then(action); return roomControlQueue; }
async function roomSendHostControl(kind, position = roomLastPosition, media = null) {
  if (!activeRoom || !roomIsHost()) return;
  roomProgressPending = null;
  if (kind === 'pause') roomPlayerIsPlaying = false;
  else if (kind === 'play') roomPlayerIsPlaying = true;
  const playbackSeq = ++roomPlaybackSeq;
  const payload = { room_id: activeRoom.room.id, kind, position_seconds: Math.max(0, Number(position) || 0), playback_state: roomPlayerIsPlaying ? 'playing' : 'paused', playback_seq: playbackSeq };
  if (media) payload.media = media;
  return roomQueueAction(async () => {
    if (!activeRoom || !roomIsHost()) return;
    try { const result = await roomApi('control', payload); roomLastRevision = Math.max(roomLastRevision, Number(result.revision) || 0); roomPlaybackSeq = Math.max(roomPlaybackSeq, Number(result.playback_seq) || playbackSeq); if (result.playback_updated_at) roomLastPlaybackUpdatedAt = result.playback_updated_at; }
    catch (error) { roomToast(error.message || 'Playback sync failed.'); }
  });
}
function applyRoomPlayerCommand(action, position) {
  const frame = roomEl('player'); if (!frame?.contentWindow) return;
  try { frame.contentWindow.postMessage({ type: 'ANIMESTREAM_ROOM_CONTROL', action, position_seconds: Math.max(0, Number(position) || 0) }, location.origin); } catch (_) {}
}
function roomApplyPlaybackSnapshot(room, force = false) {
  if (!activeRoom || roomIsHost()) return;
  const media = room.media || {}, local = roomMediaSnapshot();
  const same = local && local.type === media.type && String(local.ani_id || local.tmdb || local.tvmaze || local.imdb) === String(media.ani_id || media.tmdb || media.tvmaze || media.imdb) && Number(local.episode_index || 0) === Number(media.episode_index || 0) && Number(local.season || 1) === Number(media.season || 1);
  if (!same) { roomApplying = true; roomOpenMedia(media).finally(() => { roomApplying = false; roomApplyPlaybackSnapshot(room, true); }); return; }
  const updatedAt = Date.parse(room.playback_updated_at || '') || Date.now();
  const target = Math.max(0, Number(room.position_seconds || 0) + (room.playback_state === 'playing' ? (Date.now() - updatedAt) / 1000 : 0));
  if (force || Math.abs(roomLastPosition - target) > 1.2) { roomLastPosition = target; applyRoomPlayerCommand('seek', target); }
  const shouldPlay = room.playback_state === 'playing';
  if (force || roomPlayerIsPlaying !== shouldPlay) { roomPlayerIsPlaying = shouldPlay; applyRoomPlayerCommand(shouldPlay ? 'play' : 'pause', target); }
}
function roomApplyRealtimePlayback(payload) {
  if (!activeRoom || roomIsHost()) return;
  const room = activeRoom.room;
  if (payload.media && payload.command === 'episode') {
    room.media = payload.media;
    roomApplyPlaybackSnapshot({ ...room, ...payload }, true);
    return;
  }
  room.playback_state = payload.playback_state || room.playback_state;
  room.position_seconds = Number(payload.position_seconds) || 0;
  room.playback_updated_at = payload.playback_updated_at || new Date().toISOString();
  const target = Math.max(0, Number(payload.position_seconds) || 0);
  if (payload.command === 'seek') {
    roomLastPosition = target;
    applyRoomPlayerCommand('seek', target);
    roomPlayerIsPlaying = room.playback_state === 'playing';
    applyRoomPlayerCommand(roomPlayerIsPlaying ? 'play' : 'pause', target);
  } else if (payload.command === 'play' || payload.command === 'pause') {
    roomLastPosition = target;
    applyRoomPlayerCommand('seek', target);
    roomPlayerIsPlaying = payload.command === 'play';
    applyRoomPlayerCommand(payload.command, target);
  }
  roomLastPlaybackUpdatedAt = room.playback_updated_at;
  roomPlaybackSeq = Math.max(roomPlaybackSeq, Number(payload.playback_seq) || 0);
}

function roomApplyRealtimePosition(payload) {
  if (!activeRoom || roomIsHost()) return;
  const wasPaused = activeRoom.room.playback_state === 'paused';
  activeRoom.room.playback_state = payload.playback_state || activeRoom.room.playback_state;
  if (activeRoom.room.playback_state === 'paused') return;
  const updatedAt = Date.parse(payload.playback_updated_at || '') || Date.now();
  const target = Math.max(0, Number(payload.position_seconds || 0) + (Date.now() - updatedAt) / 1000);
  if (wasPaused || Math.abs(roomLastPosition - target) > 1.0) {
    roomLastPosition = target;
    applyRoomPlayerCommand('seek', target);
  }
  if (wasPaused) { roomPlayerIsPlaying = true; applyRoomPlayerCommand('play', target); }
  activeRoom.room.position_seconds = Number(payload.position_seconds) || 0;
  activeRoom.room.playback_updated_at = payload.playback_updated_at || activeRoom.room.playback_updated_at;
  roomLastPlaybackUpdatedAt = activeRoom.room.playback_updated_at;
  roomPlaybackSeq = Math.max(roomPlaybackSeq, Number(payload.playback_seq) || 0);
}
let roomProgressInFlight = false;
let roomProgressPending = null;
async function roomSendProgress() {
  if (!activeRoom || !roomIsHost() || !roomPlayerIsPlaying) return;
  roomProgressPending = { roomId: activeRoom.room.id, position: roomLastPosition, playbackSeq: ++roomPlaybackSeq };
  if (roomProgressInFlight) return;
  roomProgressInFlight = true;
  try {
    while (roomProgressPending && activeRoom) {
      const next = roomProgressPending;
      roomProgressPending = null;
      if (!roomIsHost() || activeRoom.room.id !== next.roomId || !roomPlayerIsPlaying) break;
      try {
        const result = await roomApi('progress', { room_id: next.roomId, position_seconds: next.position, playback_state: 'playing', playback_seq: next.playbackSeq });
        roomLastRevision = Math.max(roomLastRevision, Number(result.revision) || 0);
        roomPlaybackSeq = Math.max(roomPlaybackSeq, Number(result.playback_seq) || next.playbackSeq);
        if (result.playback_updated_at) roomLastPlaybackUpdatedAt = result.playback_updated_at;
      } catch (error) {
        if (error.status === 403 || error.status === 410) roomFinishLocally('Your host session is no longer active.');
        else console.warn('Room position sync failed', error.message);
      }
    }
  } finally { roomProgressInFlight = false; }
}
async function roomOpenMedia(media) {
  if (!media) return;
  if (media.type === 'anime') { await openAnime(Number(media.ani_id) || 0, Number(media.mal_id) || 0, media.title, Number(media.episodes) || 12, true); await playAnime(Math.max(0, Number(media.episode_index) || 0)); }
  else if (media.type === 'movie') openMovie(Number(media.tmdb) || 0, String(media.imdb || ''), media.title, true);
  else if (media.type === 'tv') { await openTv(String(media.imdb || ''), String(media.tvmaze || ''), media.title, true); if (Number(media.season) > 0 && Number(media.season) !== Number(season)) setSeason(Number(media.season)); playTv(Math.max(0, Number(media.episode_index) || 0)); }
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
  roomStopPolling(); clearInterval(roomHeartbeatTimer); clearTimeout(roomRefreshTimer); roomClearHostPauseTimer(); roomProgressPending = null;
  if (roomChannel && roomRt) { try { await roomRt.removeChannel(roomChannel); } catch (_) {} }
  roomChannel = null; roomChannelTopic = ''; roomRealtimeConnected = false; activeRoom = null; roomLastRevision = 0; roomLastPlaybackRevision = 0; roomPlaybackSeq = 0; roomLastPlaybackUpdatedAt = ''; roomSeenMessages.clear();
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
    roomLastPosition = nextPosition;
    if (!activeRoom) { if (advanced) roomPlayerIsPlaying = true; return; }
    if (roomIsHost()) {
      if (advanced && !roomPlayerIsPlaying) {
        roomPlayerIsPlaying = true;
        roomSendHostControl('play', nextPosition);
      } else if (Math.abs(delta) > 4.5) {
        // Detect seeks on players that report position but omit a seek event.
        roomSendHostControl('seek', nextPosition);
      }
      if (advanced) {
        roomLastHostProgressMessageAt = Date.now();
        roomArmHostPauseTimer();
      }
      if (roomPlayerIsPlaying && Date.now() - roomLastProgressAt >= ROOM_PROGRESS_MS) {
        roomLastProgressAt = Date.now();
        roomSendProgress();
      }
    }
    return;
  }
  if (message.kind === 'seek') {
    roomLastPosition = Math.max(0, Number(message.time) || roomLastPosition);
    if (activeRoom && roomIsHost()) roomSendHostControl('seek', roomLastPosition);
    return;
  }
  if (message.kind === 'play' || message.kind === 'pause') {
    roomPlayerIsPlaying = message.kind === 'play';
    if (message.kind === 'pause') roomClearHostPauseTimer();
    if (activeRoom && roomIsHost()) roomSendHostControl(message.kind, roomLastPosition);
    if (roomPlayerIsPlaying) { roomLastHostProgressMessageAt = Date.now(); roomArmHostPauseTimer(); }
  }
}
function roomOnPlayerLoaded() { if (!activeRoom || roomIsHost()) return; roomSetPlayerAccess(); roomApplyPlaybackSnapshot(activeRoom.room, true); }

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
    if (!roomApplying) { roomLastPosition = 0; roomPlayerIsPlaying = false; }
    const result = original.apply(this, args);
    if (activeRoom && roomIsHost() && !roomApplying) {
      const publish = () => roomSendHostControl('episode', 0, roomMediaSnapshot());
      if (result && typeof result.then === 'function') result.then(() => setTimeout(publish, 180)); else setTimeout(publish, 180);
    }
    return result;
  };
}
['openAnime', 'openMovie', 'openTv', 'playAnime', 'playTv', 'setSeason', 'setAnimeSeason'].forEach(roomWrapMediaAction);


document.addEventListener('visibilitychange', () => { if (document.hidden) roomClearHostPauseTimer(); else if (activeRoom) { roomHeartbeat(); if (roomIsHost() && roomPlayerIsPlaying) { roomLastHostProgressMessageAt = Date.now(); roomArmHostPauseTimer(); } } });
