// AnimeStream Watch Rooms: presentation layer.
//
// rooms.js owns everything about a room's behaviour: the Rooms API, Realtime, host signing,
// playback synchronisation, heartbeats. This file owns how a room looks and feels: members,
// chat feed, the details drop-down, mobile viewport handling and the leave/end confirmations.
// It is loaded after rooms.js and replaces only rooms.js's presentation functions
// (roomRenderMembers, roomRenderMessages, roomAppendMessage, roomSetPanel, roomPlacePanel,
// roomSendMessage), keeping their names and contracts, so rooms.js can be updated
// independently (for example with provider-specific pause fixes) without touching the UI.
'use strict';
(function () {
  const SEATS = 4;
  // Keep in sync with the compact media query in site.css.
  const COMPACT_QUERY = '(max-width: 860px), (orientation: portrait), (orientation: landscape) and (max-height: 520px), (orientation: landscape) and (max-width: 1000px) and (max-height: 760px)';
  const GROUP_GAP_MS = 3 * 60 * 1000;
  const TINTS = [215, 265, 160, 28, 340, 190];

  const $ = id => document.getElementById(id);
  const compactMedia = window.matchMedia ? window.matchMedia(COMPACT_QUERY) : null;
  const isCompact = () => !!compactMedia && compactMedia.matches;

  // ------------------------------------------------------------ small helpers
  function initial(name) { return String(name || 'A').trim().slice(0, 1).toUpperCase() || 'A'; }
  function tint(name) {
    let hash = 0; const text = String(name || '');
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return `hsl(${TINTS[hash % TINTS.length]} 28% 34%)`;
  }
  function avatar(name) {
    const el = document.createElement('span');
    el.className = 'room-avatar'; el.textContent = initial(name); el.style.setProperty('--tint', tint(name));
    return el;
  }
  function clock(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function hostOf(room) { return (room?.members || []).find(m => m.role === 'host') || null; }
  function setText(id, text) { const el = $(id); if (el && el.textContent !== text) el.textContent = text; }

  // --------------------------------------------------------------- connection
  // rooms.js writes plain text ("Live", "Reconnecting"…) into #roomConnection; mirror it onto a state attribute.
  (function watchConnection() {
    const label = $('roomConnection'), status = $('roomStatus');
    if (!label || !status || !('MutationObserver' in window)) return;
    const sync = () => {
      const text = label.textContent;
      status.dataset.state = text === 'Live' ? 'live' : /reconnect/i.test(text) ? 'reconnecting' : 'connecting';
    };
    new MutationObserver(sync).observe(label, { childList: true, characterData: true, subtree: true });
    sync();
  })();

  // ------------------------------------------------------------------ members
  window.roomRenderMembers = function () {
    if (!activeRoom) return;
    const members = activeRoom.members || [];
    const host = hostOf(activeRoom);
    const isHost = roomIsHost();
    const hostName = host?.name || 'The host';
    const meId = accountUser?.id;
    const count = `${members.length} of ${SEATS}`;

    setText('roomMemberCount', count); setText('roomHeadCount', count);
    setText('roomTitle', isHost ? 'Your watch party' : `${hostName}\u2019s watch party`);

    const code = $('roomCode');
    if (code && activeRoom.room?.code) {
      const raw = String(activeRoom.room.code);
      code.textContent = raw.length === 8 ? `${raw.slice(0, 4)} ${raw.slice(4)}` : raw;
      code.setAttribute('aria-label', `Room code ${raw.split('').join(' ')}`);
    }

    const list = $('roomMemberList');
    if (list) {
      list.replaceChildren(...members.map(member => {
        const row = document.createElement('div'); row.className = 'room-member';
        const name = document.createElement('span'); name.className = 'room-member-name'; name.textContent = member.name || 'AnimeStream member';
        row.append(avatar(member.name), name);
        if (member.account_id === meId) { const you = document.createElement('span'); you.className = 'room-you'; you.textContent = 'You'; row.append(you); }
        if (member.role === 'host') { const tag = document.createElement('span'); tag.className = 'room-tag host'; tag.textContent = 'Host'; row.append(tag); }
        return row;
      }));
    }
    const stack = $('roomStack');
    if (stack) stack.replaceChildren(...members.slice(0, SEATS).map(member => avatar(member.name)));

    setText('roomPlaybackStatus', isHost ? 'You control playback for everyone.' : `${hostName} controls playback.`);
    setText('roomLockText', `${hostName} controls playback`);

    const endButton = $('roomEndButton'); if (endButton) endButton.hidden = !isHost;
    const endHint = $('roomEndHint'); if (endHint) endHint.hidden = !isHost;
    const localVolume = $('roomLocalVolumeControl'); if (localVolume) localVolume.hidden = isHost;
    const volumeRange = $('roomLocalVolumeRange'); if (volumeRange && document.activeElement !== volumeRange) volumeRange.value = String(Math.round(roomLocalVolume * 100));
    setText('roomLocalVolumeValue', `${Math.round(roomLocalVolume * 100)}%`);
    const createButton = $('createRoomButton'); if (createButton) createButton.hidden = !!activeRoom;

    const layout = document.querySelector('#playerView .player-layout');
    if (layout) layout.dataset.roomRole = isHost ? 'host' : 'guest';
    const panel = $('roomPanel'); if (panel) panel.dataset.role = isHost ? 'host' : 'guest';

    syncNowPlaying(); renderEmptyIfNeeded();
    roomSetPlayerAccess();
  };
  function syncNowPlaying() {
    const title = document.getElementById('mediaTitle')?.textContent?.trim() || activeRoom?.room?.media?.title || '';
    const meta = document.getElementById('mediaMeta')?.textContent?.trim() || '';
    setText('roomNowTitle', meta && meta !== 'Loading\u2026' ? `${title} (${meta})` : title);
  }

  // --------------------------------------------------------------------- chat
  let feedIds = [];
  let feedStuck = true;
  let feedUnread = 0;
  const feedEl = () => $('roomChatMessages');
  const nearBottom = feed => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 56;

  function addToFeed(feed, message) {
    const mine = message.sender_account_id === accountUser?.id;
    const sent = Date.parse(message.created_at) || Date.now();
    const bubble = document.createElement('p');
    bubble.className = 'room-bubble'; bubble.dataset.messageId = message.id; bubble.textContent = message.body;
    bubble.title = new Date(sent).toLocaleString();
    const last = feed.lastElementChild;
    if (last && last.classList.contains('room-group') && last.dataset.sender === String(message.sender_account_id) && sent - Number(last.dataset.t) < GROUP_GAP_MS) {
      last.querySelector('.room-bubbles').append(bubble); last.dataset.t = String(sent);
      return;
    }
    const group = document.createElement('div');
    group.className = `room-group${mine ? ' mine' : ''}`; group.dataset.sender = String(message.sender_account_id); group.dataset.t = String(sent);
    const meta = document.createElement('div'); meta.className = 'room-meta';
    if (!mine) {
      const name = document.createElement('strong'); name.className = 'room-name'; name.textContent = message.name || 'AnimeStream member';
      meta.append(name);
      if (message.sender_account_id && message.sender_account_id === activeRoom?.room?.host_account_id) {
        const tag = document.createElement('span'); tag.className = 'room-tag host'; tag.textContent = 'Host'; meta.append(tag);
      }
    }
    const time = document.createElement('time'); time.dateTime = new Date(sent).toISOString(); time.textContent = clock(message.created_at); meta.append(time);
    const bubbles = document.createElement('div'); bubbles.className = 'room-bubbles'; bubbles.append(bubble);
    const body = document.createElement('div'); body.className = 'room-group-body'; body.append(meta, bubbles);
    if (mine) group.append(body); else group.append(avatar(message.name), body);
    feed.append(group);
  }
  function renderEmptyIfNeeded() {
    const feed = feedEl(); if (!feed || !activeRoom) return;
    if (feed.querySelector('.room-group')) { feed.querySelector('.room-empty')?.remove(); return; }
    const alone = (activeRoom.members || []).length <= 1 && roomIsHost();
    const empty = document.createElement('div'); empty.className = 'room-empty';
    const title = document.createElement('strong'); const text = document.createElement('span');
    if (alone) {
      title.textContent = 'Invite your friends';
      text.textContent = 'Share the code or the link. Up to 3 friends can join, and the chat shows up here.';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'room-btn'; button.textContent = 'Copy invite link';
      button.addEventListener('click', () => roomShare());
      empty.append(title, text, button);
    } else {
      title.textContent = 'No messages yet';
      text.textContent = 'Say something to the room.';
      empty.append(title, text);
    }
    feed.replaceChildren(empty);
  }
  function updateJump() {
    const jump = $('roomJump'); if (!jump) return;
    const show = !feedStuck && feedUnread > 0;
    jump.hidden = !show;
    if (show) setText('roomJumpLabel', feedUnread === 1 ? '1 new message' : `${feedUnread} new messages`);
  }
  function scrollFeedToEnd() {
    const feed = feedEl(); if (!feed) return;
    feed.scrollTop = feed.scrollHeight; feedStuck = true; feedUnread = 0; updateJump();
  }
  window.roomScrollToLatest = scrollFeedToEnd;

  window.roomRenderMessages = function (messages, forceBottom = false) {
    const feed = feedEl(); if (!feed) return;
    const list = messages || [];
    const ids = list.map(message => message.id);
    const sameLength = ids.length === feedIds.length;
    const unchanged = sameLength && ids.every((id, i) => id === feedIds[i]);
    // A snapshot that was requested before our own newest message was stored is simply older than the screen.
    const olderSnapshot = !unchanged && feedIds.length > ids.length && ids.every((id, i) => id === feedIds[i]);
    if (!unchanged && !olderSnapshot) {
      const wasStuck = feedStuck || nearBottom(feed);
      const appendOnly = feedIds.length > 0 && feedIds.length < ids.length && feedIds.every((id, i) => id === ids[i]);
      if (appendOnly) {
        const added = list.slice(feedIds.length);
        added.forEach(message => addToFeed(feed, message));
        if (!wasStuck && !forceBottom) feedUnread += added.filter(message => message.sender_account_id !== accountUser?.id).length;
      } else {
        const fromBottom = feed.scrollHeight - feed.scrollTop;
        feed.replaceChildren(); list.forEach(message => addToFeed(feed, message));
        if (!wasStuck && !forceBottom) feed.scrollTop = Math.max(0, feed.scrollHeight - fromBottom);
      }
      feedIds = ids;
      if (wasStuck || forceBottom) { feed.scrollTop = feed.scrollHeight; feedStuck = true; feedUnread = 0; }
      updateJump();
    }
    if (olderSnapshot) { /* keep what is on screen */ } else roomSeenMessages = new Set(ids);
    renderEmptyIfNeeded();
    if (forceBottom) scrollFeedToEnd();
  };

  window.roomAppendMessage = function (message) {
    if (!activeRoom || !message || roomSeenMessages.has(message.id)) return;
    if (!activeRoom.messages) activeRoom.messages = [];
    activeRoom.messages.push(message);
    if (activeRoom.messages.length > 60) activeRoom.messages.shift();
    roomSeenMessages.add(message.id);
    window.roomRenderMessages(activeRoom.messages);
  };

  window.roomSendMessage = async function (event) {
    if (event) event.preventDefault();
    if (!activeRoom) return false;
    const input = $('roomChatInput'), body = String(input?.value || '').trim();
    if (!body) return false;
    if (body.length > 500) { roomToast('Messages must be 500 characters or fewer.'); return false; }
    if (input) input.value = '';
    syncComposer();
    try {
      const result = await roomApi('send_message', { room_id: activeRoom.room.id, body });
      roomAppendMessage(result.message); scrollFeedToEnd();
    } catch (error) {
      roomToast(error.message || 'Message was not sent.');
      if (input && !input.value) { input.value = body; syncComposer(); }
    }
    return false;
  };

  function syncComposer() {
    const input = $('roomChatInput'), send = $('roomSendButton'), count = $('roomCount');
    if (!input) return;
    const length = input.value.length;
    if (send) send.disabled = !input.value.trim();
    if (count) {
      count.hidden = length < 400; count.textContent = `${length}/500`;
      count.classList.toggle('near', length >= 480);
    }
  }

  (function bindChat() {
    const feed = feedEl(), input = $('roomChatInput'), send = $('roomSendButton');
    if (feed) {
      feed.addEventListener('scroll', () => {
        feedStuck = nearBottom(feed);
        if (feedStuck) feedUnread = 0;
        updateJump();
      }, { passive: true });
      // Layout settling (panel opening, keyboard, rotation) must not strand the reader above the newest message.
      if ('ResizeObserver' in window) new ResizeObserver(() => { if (feedStuck) feed.scrollTop = feed.scrollHeight; }).observe(feed);
    }
    if (input) {
      input.addEventListener('input', syncComposer);
      input.addEventListener('focus', () => window.roomToggleDetails(false));
    }
    // Keep the keyboard up when sending from a phone: tapping Send must not steal focus from the field.
    if (send) send.addEventListener('pointerdown', event => event.preventDefault());
  })();

  // ------------------------------------------------------------------ details
  function syncDetailsMode() {
    const panel = $('roomPanel'), toggle = $('roomInfoToggle');
    if (!panel || !toggle) return;
    if (!panel.dataset.details) panel.dataset.details = 'closed';
    toggle.setAttribute('aria-expanded', String(panel.dataset.details === 'open'));
  }
  window.roomToggleDetails = function (force) {
    const panel = $('roomPanel'); if (!panel) return;
    const open = typeof force === 'boolean' ? force : panel.dataset.details !== 'open';
    panel.dataset.details = open ? 'open' : 'closed';
    $('roomInfoToggle')?.setAttribute('aria-expanded', String(open));
    if (open) syncNowPlaying();
  };

  // ------------------------------------------------------------ panel + stage
  window.roomPlacePanel = function () { /* the rail stays in the side column in every layout */ };
  window.roomSetPanel = function (show) {
    const panel = $('roomPanel');
    const layout = document.querySelector('#playerView .player-layout');
    const side = document.querySelector('#playerView .player-side');
    const wasActive = !!layout?.classList.contains('room-active');
    if (panel) { panel.hidden = !show; if (!show) panel.dataset.details = 'closed'; }
    if (layout) { layout.classList.toggle('room-active', !!show); if (!show) delete layout.dataset.roomRole; }
    if (side) side.classList.toggle('room-active', !!show);
    const upNext = document.querySelector('#playerView .up-next'); if (upNext) upNext.hidden = !!show;
    const episodes = $('epPanel'); if (episodes) episodes.hidden = false; // the host can browse episodes inside a room
    if (show && !wasActive && episodes) {
      episodes.classList.remove('open');
      const toggle = $('epToggle'); if (toggle) { toggle.classList.remove('active'); toggle.setAttribute('aria-expanded', 'false'); }
    }
    document.body.classList.toggle('room-live', !!show);
    if (!show) { feedIds = []; feedStuck = true; feedUnread = 0; feedEl()?.replaceChildren(); updateJump(); disarmEnd(); }
    syncCompactState(); syncDetailsMode(); syncViewport();
    roomSetPlayerAccess();
  };

  function syncCompactState() { document.body.classList.toggle('room-compact', !!activeRoom && isCompact()); }

  // Picking an episode closes the sheet so the chat comes back.
  $('episodeList')?.addEventListener('click', event => {
    if (!activeRoom || !event.target.closest('.ep')) return;
    setTimeout(() => { if ($('epPanel')?.classList.contains('open')) toggleEpisodes(); }, 160);
  });

  // ----------------------------------------------------------- mobile keyboard
  // Browsers resize only the *visual* viewport when the keyboard opens. Fit the room to what is actually visible
  // so the composer stays above the keyboard and the video is never pushed off the top.
  function syncViewport() {
    const root = document.documentElement, vv = window.visualViewport;
    const reset = () => { root.style.removeProperty('--room-vh'); root.style.removeProperty('--room-vt'); document.body.classList.remove('room-kb'); };
    if (!vv || !activeRoom || !isCompact() || vv.scale > 1.01) { reset(); return; }
    const keyboard = window.innerHeight - vv.height > 120;
    if (!keyboard) { reset(); return; }
    root.style.setProperty('--room-vh', `${Math.round(vv.height)}px`);
    root.style.setProperty('--room-vt', `${Math.round(vv.offsetTop)}px`);
    document.body.classList.add('room-kb');
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
  }
  window.addEventListener('resize', () => { syncCompactState(); syncDetailsMode(); syncViewport(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { syncCompactState(); syncDetailsMode(); syncViewport(); }, 120));
  if (compactMedia && compactMedia.addEventListener) compactMedia.addEventListener('change', () => { syncCompactState(); syncDetailsMode(); syncViewport(); });
  $('roomChatInput')?.addEventListener('blur', () => setTimeout(() => { if (document.body.classList.contains('room-live')) { syncViewport(); if (!document.body.classList.contains('room-kb')) window.scrollTo(0, 0); } }, 60));

  // ---------------------------------------------------------- leave + end flow
  let endTimer = null, leaveThenBack = false;
  function disarmEnd() {
    clearTimeout(endTimer); endTimer = null;
    const button = $('roomEndButton'); if (!button) return;
    if (button.dataset.armed === 'true') button.textContent = 'End room';
    button.dataset.armed = 'false';
  }
  // Ending deletes the room code and chat for everyone, so it takes two deliberate taps.
  window.roomRequestEnd = function () {
    const button = $('roomEndButton'); if (!button || button.disabled || !activeRoom) return;
    if (button.dataset.armed !== 'true') {
      button.dataset.armed = 'true'; button.textContent = 'Tap again to end';
      clearTimeout(endTimer); endTimer = setTimeout(disarmEnd, 4000);
      return;
    }
    disarmEnd(); roomLeave(true);
  };

  function openLeaveModal(thenBack) {
    if (!activeRoom) return;
    const members = activeRoom.members || [], meId = accountUser?.id;
    const next = members.find(member => member.account_id !== meId);
    leaveThenBack = !!thenBack;
    setText('roomLeaveTitle', next ? 'Leave this room?' : 'Leave and close the room?');
    setText('roomLeaveText', next
      ? `${next.name} becomes the host. You can rejoin later with the invite code.`
      : 'You are the only one here, so leaving deletes the room and its chat.');
    $('roomLeaveModal').hidden = false;
    setTimeout(() => $('roomLeaveModal')?.querySelector('.room-btn')?.focus(), 30);
  }
  window.roomCloseLeaveModal = function () { const modal = $('roomLeaveModal'); if (modal) modal.hidden = true; leaveThenBack = false; };
  window.roomConfirmLeave = async function () {
    const back = leaveThenBack;
    const modal = $('roomLeaveModal'); if (modal) modal.hidden = true; leaveThenBack = false;
    await roomLeave(false);
    if (back && !activeRoom) appBack();
  };
  // Hosts confirm because leaving hands the room to someone else. Guests just leave.
  window.roomRequestLeave = function () {
    if (!activeRoom) return;
    if (roomIsHost()) openLeaveModal(false); else roomLeave(false);
  };
  // The on-page Back button used to navigate away while the person stayed in the room (still counted as a member,
  // still heartbeating). Leaving the room first makes Back do what it looks like it does.
  window.roomAwareBack = async function () {
    if (!activeRoom) { appBack(); return; }
    if (roomIsHost()) { openLeaveModal(true); return; }
    await roomLeave(false);
    if (!activeRoom) appBack();
  };

  // --------------------------------------------------------------- join dialog
  window.roomFormatJoinInput = function (input) {
    const raw = String(input.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    input.value = raw.length > 4 ? `${raw.slice(0, 4)} ${raw.slice(4)}` : raw;
    const submit = $('joinRoomSubmit'); if (submit) submit.disabled = raw.length !== 8;
  };
  const originalOpenJoin = window.openJoinRoom;
  window.openJoinRoom = function () {
    const input = $('joinRoomCode'), submit = $('joinRoomSubmit');
    if (input) input.value = ''; if (submit) submit.disabled = true;
    return originalOpenJoin.apply(this, arguments);
  };

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if ($('roomLeaveModal') && !$('roomLeaveModal').hidden) { window.roomCloseLeaveModal(); return; }
    if ($('joinRoomModal') && !$('joinRoomModal').hidden) { closeJoinRoom(); return; }
    if ($('roomPanel')?.dataset.details === 'open') window.roomToggleDetails(false);
  });

  syncComposer(); syncDetailsMode();
})();
