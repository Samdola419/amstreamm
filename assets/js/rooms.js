// AnimeStream Watch Rooms. Video is always loaded independently by each member's
// normal player. Supabase Realtime carries wake-up pings only; all trusted state,
// chat, and controls are fetched through the custom-session-protected rooms API.
'use strict';
let activeRoom = null, roomChannel = null, roomRefreshTimer = null, roomHeartbeatTimer = null;
let roomPollTimer = null, roomApplying = false, roomLastRevision = 0, roomLastPosition = 0;
let roomLastProgressAt = 0, roomLastMessageId = '', roomPendingCode = '', roomRt = null;
let roomSeenMessages = new Set();
let roomPlayerIsPlaying = false, roomSuppressPlayerEvent = null, roomLastPlaybackUpdatedAt = '';
const roomCfg = window.AUTH_CONFIG || {};
const ROOM_API = roomCfg.roomsApi || (roomCfg.url ? roomCfg.url + '/functions/v1/rooms-api' : '');
function roomEl(id){return document.getElementById(id);}
function roomEsc(s){return typeof escHtml==='function'?escHtml(String(s??'')):String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function roomToken(){return typeof accountTokenValue==='function'?accountTokenValue():localStorage.getItem('animestream.accountToken.v1')||'';}
async function roomApi(action,payload={}){
  if(!ROOM_API||!roomToken())throw new Error('Sign in to use Watch Rooms.');
  const res=await fetch(ROOM_API,{method:'POST',headers:{'Content-Type':'application/json','apikey':roomCfg.key,'Authorization':'Bearer '+roomToken()},cache:'no-store',credentials:'omit',body:JSON.stringify({action,...payload})});
  let data={};try{data=await res.json();}catch(_){}
  if(!res.ok){const e=new Error(data.error||'Room request failed.');e.status=res.status;throw e;}return data;
}
function roomMediaSnapshot(){
  if(!current)return null;
  const type=current.type;
  if(!['anime','movie','tv'].includes(type))return null;
  return {
    type,title:String(current.title||$('mediaTitle')?.textContent||'Untitled').slice(0,240),
    ani_id:Number(current.ani_id||current.openedId)||0,mal_id:Number(current.mal_id)||0,
    tmdb:Number(current.tmdb)||0,imdb:String(current.imdb||''),tvmaze:Number(current.tvmaze)||0,
    episodes:Number(current.episodes||0),episode_index:Number(epIndex||0),season:Number(season||1),
    language:String(current.effectiveLang||lang||'sub'),
    position_seconds:Number(roomLastPosition)||0,playback_state:roomPlayerIsPlaying?'playing':'paused'
  };
}
function roomIsHost(){return !!(activeRoom&&((activeRoom.me&&activeRoom.me.role==='host')||(accountUser&&activeRoom.room.host_account_id===accountUser.id)));}
function roomUrl(code){return location.origin+'/room/'+encodeURIComponent(code);}
function roomToast(message){if(typeof flashNote==='function')flashNote(message);}
function roomSetPanel(show){const panel=roomEl('roomPanel'),layout=document.querySelector('#playerView .player-layout'),side=document.querySelector('#playerView .player-side');if(panel)panel.hidden=!show;if(layout)layout.classList.toggle('room-active',!!show);if(side)side.classList.toggle('room-active',!!show);const episodes=roomEl('epPanel'),upNext=document.querySelector('#playerView .up-next');if(episodes)episodes.hidden=!!show;if(upNext)upNext.hidden=!!show;}
function roomRender(data){
  if(!activeRoom||!data)return;
  const oldRevision=roomLastRevision,oldPlaybackUpdatedAt=roomLastPlaybackUpdatedAt;activeRoom.room=data.room;activeRoom.members=data.members||[];activeRoom.messages=data.messages||[];activeRoom.me=data.me;
  roomLastRevision=Number(data.room.revision)||roomLastRevision;
  roomLastPlaybackUpdatedAt=data.room.playback_updated_at||roomLastPlaybackUpdatedAt;
  const count=roomEl('roomMemberCount');if(count)count.textContent=`${activeRoom.members.length}/4`;
  const list=roomEl('roomMemberList');if(list)list.innerHTML=activeRoom.members.map(m=>`<div class="room-member"><span class="room-member-avatar">${roomEsc((m.name||'A').slice(0,1).toUpperCase())}</span><span>${roomEsc(m.name)}${m.account_id===accountUser?.id?' (you)':''}</span>${m.role==='host'?'<small>HOST</small>':''}</div>`).join('');
  const code=roomEl('roomCode');if(code)code.textContent=activeRoom.room.code;
  const status=roomEl('roomPlaybackStatus');if(status)status.textContent=roomIsHost()?'You control playback':`${activeRoom.members.find(m=>m.role==='host')?.name||'Host'} controls playback`;
  const endButton=roomEl('roomEndButton');if(endButton){endButton.hidden=!roomIsHost();endButton.setAttribute('aria-hidden',String(!roomIsHost()));}
  const createButton=roomEl('createRoomButton');if(createButton)createButton.hidden=!!activeRoom;
  const chat=roomEl('roomChatMessages');if(chat){
    const atBottom=chat.scrollHeight-chat.scrollTop-chat.clientHeight<80;
    chat.innerHTML=activeRoom.messages.map(m=>`<div class="room-message ${m.sender_account_id===accountUser?.id?'mine':''}"><span class="room-msg-avatar">${roomEsc((m.name||'A').slice(0,1).toUpperCase())}</span><div class="room-msg-content"><div><strong>${roomEsc(m.name)}</strong><time>${new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></div><p>${roomEsc(m.body)}</p></div></div>`).join('')||'<div class="room-chat-empty">Be the first to say something 👋</div>';
    if(atBottom)chat.scrollTop=chat.scrollHeight;
  }
  if(!roomIsHost()&&Number(data.room.revision)>oldRevision&&roomLastPlaybackUpdatedAt!==oldPlaybackUpdatedAt)roomApplyState(data.room);
  const provider=roomEl('roomProviderNote');if(provider){provider.textContent='Playback commands are sent to each member’s own player. Some external sources may not support remote play or seek.';}
}
async function roomFetch(){if(!activeRoom)return;try{const data=await roomApi('get_room',{room_id:activeRoom.room.id});roomRender(data);}catch(e){if(e.status===403||e.status===410){roomToast('This room has ended or you are no longer a member.');roomDisconnect(true);}}}
function roomScheduleRefresh(){clearTimeout(roomRefreshTimer);roomRefreshTimer=setTimeout(()=>roomFetch(),180);}
async function roomConnect(snapshot){
  clearInterval(roomPollTimer);clearInterval(roomHeartbeatTimer);
  // Polling and the authenticated heartbeat always work, even if the optional
  // Realtime client CDN is unavailable or a WebSocket cannot be established.
  roomPollTimer=setInterval(()=>roomFetch(),3500);
  roomHeartbeatTimer=setInterval(()=>roomHeartbeat(),15000);
  const statusEl=roomEl('roomConnection');
  if(!window.supabase?.createClient){if(statusEl)statusEl.textContent='Polling';return;}
  try{
    if(!roomRt)roomRt=window.supabase.createClient(roomCfg.url,roomCfg.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    if(roomChannel){try{await roomRt.removeChannel(roomChannel);}catch(_){}roomChannel=null;}
    const topic=snapshot.room.topic;
    // This topic is an opaque 192-bit wake-up token issued after membership validation.
    // No trusted room data is sent here; snapshots always come from rooms-api.
    roomChannel=roomRt.channel(topic,{config:{broadcast:{self:false}}})
      .on('broadcast',{event:'room_event'},()=>roomScheduleRefresh())
      .subscribe(status=>{if(statusEl)statusEl.textContent=status==='SUBSCRIBED'?'Live':'Polling';});
  }catch(error){console.warn('Realtime unavailable; using authenticated polling',error?.message||error);if(statusEl)statusEl.textContent='Polling';}
}
async function roomHeartbeat(){if(!activeRoom)return;try{const data=await roomApi('heartbeat',{room_id:activeRoom.room.id});if(data?.room)roomRender(data);}catch(e){if(e.status===401||e.status===403||e.status===410)roomDisconnect(true);}}
async function roomActivate(data,{openMedia=false}={}){
  if(!data?.room)throw new Error('The room data could not be loaded.');
  activeRoom=data;roomLastRevision=Number(data.room.revision)||0;roomLastPlaybackUpdatedAt=data.room.playback_updated_at||'';roomSeenMessages=new Set();
  if(typeof pushHist==='function'&&!applyingHistory&&location.pathname!=='/room/'+data.room.code)pushHist({kind:'room',code:data.room.code});
  showPlayer();roomSetPanel(true);
  roomRender(data);await roomConnect(data);
  if(openMedia)await roomOpenMedia(data.room.media);
  if(!roomIsHost())roomApplyState(data.room,true);
  roomToast(`Joined room ${data.room.code}.`);
}
async function createWatchRoom(){
  if(!accountUser){window.pendingRoomCreate=true;openLogin();return;}
  const media=roomMediaSnapshot();if(!media){roomToast('Open an anime, movie or series first.');return;}
  try{const data=await roomApi('create_room',{media});await roomActivate(data);roomToast('Room created. Invite up to 3 friends.');}
  catch(e){roomToast(e.message||'Could not create room.');}
}
async function joinWatchRoom(code){
  if(!accountUser){roomPendingCode=String(code||'').toUpperCase();window.pendingRoomCode=roomPendingCode;openLogin();return;}
  try{const data=await roomApi('join_room',{code});await roomActivate(data,{openMedia:true});}
  catch(e){roomToast(e.message||'Could not join room.');}
}
async function roomBoot(code){const invite=String(code||'').toUpperCase();roomPendingCode=invite;window.pendingRoomCode=invite;await (window.accountReady||Promise.resolve(false));if(!accountUser){openLogin();return;}window.pendingRoomCode='';roomPendingCode='';await joinWatchRoom(invite);}
window.roomBoot=roomBoot;
window.roomsResumePending=()=>{if(window.pendingRoomCode){const code=window.pendingRoomCode;window.pendingRoomCode='';roomPendingCode='';joinWatchRoom(code).catch(e=>roomToast(e.message));}else if(window.pendingRoomCreate){window.pendingRoomCreate=false;createWatchRoom();}};
function openJoinRoom(){const m=roomEl('joinRoomModal');if(!accountUser){openLogin();return;}if(m){m.hidden=false;setTimeout(()=>roomEl('joinRoomCode')?.focus(),40);}}
function closeJoinRoom(){const m=roomEl('joinRoomModal');if(m)m.hidden=true;}
async function submitJoinRoom(e){if(e)e.preventDefault();const code=String(roomEl('joinRoomCode')?.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(code.length!==8){roomToast('Enter the 8-character room code.');return false;}closeJoinRoom();await joinWatchRoom(code);return false;}
async function roomShare(){if(!activeRoom)return;const url=roomUrl(activeRoom.room.code);try{await navigator.clipboard.writeText(url);roomToast('Room invite link copied.');}catch(_){window.prompt('Copy this room invite link:',url);}}
async function roomCopyCode(){if(!activeRoom)return;const code=activeRoom.room.code;try{await navigator.clipboard.writeText(code);roomToast('Room code copied.');}catch(_){window.prompt('Copy this room code:',code);}}
async function roomSendMessage(e){if(e)e.preventDefault();if(!activeRoom)return false;const input=roomEl('roomChatInput'),body=String(input?.value||'').trim();if(!body)return false;if(body.length>500){roomToast('Messages must be 500 characters or fewer.');return false;}if(input)input.value='';try{const result=await roomApi('send_message',{room_id:activeRoom.room.id,body});if(result.message){activeRoom.messages.push(result.message);activeRoom.messages=activeRoom.messages.slice(-60);roomRender({room:activeRoom.room,members:activeRoom.members,messages:activeRoom.messages,me:activeRoom.me});}}catch(err){roomToast(err.message||'Message was not sent.');if(input)input.value=body;}return false;}
async function roomControl(kind,position,applyLocal=true){if(!activeRoom||!roomIsHost())return;try{const result=await roomApi('control',{room_id:activeRoom.room.id,kind,position_seconds:Number(position??roomLastPosition),playback_state:activeRoom.room.playback_state,media:kind==='episode'?roomMediaSnapshot():undefined});roomLastRevision=Number(result.revision)||roomLastRevision;activeRoom.room.revision=roomLastRevision;activeRoom.room.playback_updated_at=result.playback_updated_at||new Date().toISOString();if(kind==='play'||kind==='pause'||kind==='seek'){if(kind==='play')roomPlayerIsPlaying=true;else if(kind==='pause')roomPlayerIsPlaying=false;activeRoom.room.playback_state=kind==='play'?'playing':kind==='pause'?'paused':activeRoom.room.playback_state;activeRoom.room.position_seconds=Number(position??roomLastPosition);if(applyLocal)applyRoomPlayerCommand(kind,Number(position??roomLastPosition));}else if(kind==='episode'){activeRoom.room.media=roomMediaSnapshot();activeRoom.room.position_seconds=0;activeRoom.room.playback_state='paused';}}catch(e){roomToast(e.message||'Could not sync playback.');}}
function applyRoomPlayerCommand(action,position){const frame=document.getElementById('player');if(!frame?.contentWindow)return;if(roomIsHost()&&['play','pause'].includes(action))roomSuppressPlayerEvent={kind:action,until:Date.now()+1200};const payload={type:'ANIMESTREAM_ROOM_CONTROL',action,position_seconds:Number(position)||0};try{frame.contentWindow.postMessage(payload,location.origin);}catch(_){} }
function roomApplyState(room,force=false){
  if(!activeRoom||roomApplying||roomIsHost())return;
  const m=room.media||{};const currentMedia=roomMediaSnapshot();
  const same=currentMedia&&currentMedia.type===m.type&&String(currentMedia.ani_id||currentMedia.tmdb||currentMedia.tvmaze||currentMedia.imdb)===String(m.ani_id||m.tmdb||m.tvmaze||m.imdb)&&Number(currentMedia.episode_index||0)===Number(m.episode_index||0)&&Number(currentMedia.season||1)===Number(m.season||1);
  if(!same){roomApplying=true;roomOpenMedia(m).finally(()=>{roomApplying=false;roomApplyState(room,true);});return;}
  const elapsed=room.playback_state==='playing'?Math.max(0,(Date.now()-Date.parse(room.playback_updated_at||new Date().toISOString()))/1000):0;
  const target=Math.max(0,Number(room.position_seconds||0)+elapsed);
  if(Math.abs(roomLastPosition-target)>2.5){roomLastPosition=target;applyRoomPlayerCommand('seek',target);}
  const shouldPlay=room.playback_state==='playing';
  if(force||roomPlayerIsPlaying!==shouldPlay){roomPlayerIsPlaying=shouldPlay;applyRoomPlayerCommand(shouldPlay?'play':'pause',target);}
}
async function roomOpenMedia(m){
  if(!m)return;
  if(m.type==='anime'){
    await openAnime(Number(m.ani_id)||0,Number(m.mal_id)||0,m.title,Number(m.episodes)||12,true);
    await playAnime(Math.max(0,Number(m.episode_index)||0));
  }else if(m.type==='movie'){
    openMovie(Number(m.tmdb)||0,String(m.imdb||''),m.title,true);
  }else if(m.type==='tv'){
    await openTv(String(m.imdb||''),String(m.tvmaze||''),m.title,true);
    if(Number(m.season)>0&&Number(m.season)!==Number(season))setSeason(Number(m.season));
    playTv(Math.max(0,Number(m.episode_index)||0));
  }
}
async function roomLeave(end=false){
  if(!activeRoom)return;
  const roomId=activeRoom.room.id,button=end?roomEl('roomEndButton'):null;
  if(button){button.disabled=true;button.textContent='Ending…';}
  try{await roomApi(end?'end_room':'leave_room',{room_id:roomId});}
  catch(error){if(button){button.disabled=false;button.textContent='End room';}roomToast(error.message||(end?'Could not end the room.':'Could not leave the room.'));return;}
  await roomDisconnect(false);
  if(location.pathname.startsWith('/room/')){if(typeof appBack==='function')appBack();else history.replaceState(history.state,'','/');}
  roomToast(end?'Room ended.':'You left the room.');
}
async function roomDisconnect(resetUrl=true){clearInterval(roomPollTimer);clearInterval(roomHeartbeatTimer);clearTimeout(roomRefreshTimer);if(roomChannel&&roomRt){try{await roomRt.removeChannel(roomChannel);}catch(_){}}roomChannel=null;activeRoom=null;roomLastRevision=0;roomLastPlaybackUpdatedAt='';roomSetPanel(false);const createButton=roomEl('createRoomButton');if(createButton)createButton.hidden=false;const endButton=roomEl('roomEndButton');if(endButton){endButton.hidden=true;endButton.disabled=false;endButton.textContent='End room';}if(resetUrl&&location.pathname.startsWith('/room/'))history.replaceState(history.state,'','/');}
function roomOnPlayerMessage(message) {
  if (!message) return;
  if (message.kind === 'time') {
    const previousPosition = roomLastPosition;
    roomLastPosition = Number(message.time) || 0;
    if (roomLastPosition > previousPosition + 0.15) roomPlayerIsPlaying = true;
    if (!activeRoom) return;
    if (roomIsHost() && roomPlayerIsPlaying && Date.now() - roomLastProgressAt > 5000) {
      roomLastProgressAt = Date.now();
      activeRoom.room.playback_state = 'playing';
      roomApi('progress', { room_id: activeRoom.room.id, position_seconds: roomLastPosition, playback_state: 'playing' })
        .then(result => {
          if (!activeRoom) return;
          roomLastRevision = Number(result.revision) || roomLastRevision;
          activeRoom.room.revision = roomLastRevision;
          activeRoom.room.position_seconds = roomLastPosition;
          activeRoom.room.playback_updated_at = result.playback_updated_at || new Date().toISOString();
          roomLastPlaybackUpdatedAt = activeRoom.room.playback_updated_at;
        })
        .catch(error => console.warn('Room progress sync failed', error.message));
    }
  } else if (message.kind === 'seek') {
    roomLastPosition = Math.max(0, Number(message.time) || 0);
    if (activeRoom && roomIsHost()) roomControl('seek', roomLastPosition, false);
  } else if (message.kind === 'play' || message.kind === 'pause') {
    roomPlayerIsPlaying = message.kind === 'play';
    if (activeRoom && roomIsHost()) {
      if (roomSuppressPlayerEvent && roomSuppressPlayerEvent.kind === message.kind && roomSuppressPlayerEvent.until > Date.now()) {
        roomSuppressPlayerEvent = null;
        return;
      }
      roomSuppressPlayerEvent = null;
      roomControl(message.kind, roomLastPosition, false);
    }
  }
}
function roomOnPlayerLoaded(){if(activeRoom&&!roomIsHost())roomApplyState(activeRoom.room,true);}
window.createWatchRoom=createWatchRoom;window.openJoinRoom=openJoinRoom;window.closeJoinRoom=closeJoinRoom;window.submitJoinRoom=submitJoinRoom;window.roomShare=roomShare;window.roomCopyCode=roomCopyCode;window.roomSendMessage=roomSendMessage;window.roomLeave=roomLeave;

// When the host changes the title, season, or episode using the normal AnimeStream
// controls, publish that selection as the room's new shared media state.
function roomWrapMediaAction(name){const original=window[name];if(typeof original!=='function')return;window[name]=function(...args){if(!roomApplying){roomLastPosition=0;roomPlayerIsPlaying=false;}const result=original.apply(this,args);if(activeRoom&&roomIsHost()&&!roomApplying){const publish=()=>roomControl('episode',0);if(result&&typeof result.then==='function')result.then(()=>setTimeout(publish,250));else setTimeout(publish,250);}return result;};}
['openAnime','openMovie','openTv','playAnime','playTv','setSeason','setAnimeSeason'].forEach(roomWrapMediaAction);
