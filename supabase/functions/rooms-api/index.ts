import { createClient } from 'npm:@supabase/supabase-js@2.110.9'
const URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
if (!URL || !SERVICE) throw new Error('Missing Supabase server environment')
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
const origins = new Set(['https://www.amstream.site','https://amstream.site','http://localhost:3000','http://127.0.0.1:3000','http://localhost:5173','http://127.0.0.1:5173'])
const allowed = (o: string | null) => !!o && (origins.has(o) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(o))
const cors = (o: string | null) => ({ 'Access-Control-Allow-Origin': allowed(o) && o ? o : 'https://www.amstream.site', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' })
function reply(req: Request, data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors(req.headers.get('origin')), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }) }
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2,'0')).join('')
async function digest(v: string) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))) }
function random(bytes: number) { const b=new Uint8Array(bytes);crypto.getRandomValues(b);return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'') }
function code() { const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',b=new Uint8Array(8);crypto.getRandomValues(b);return Array.from(b,x=>a[x%a.length]).join('') }
async function auth(req: Request) {
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim()
  if(token.length<32||token.length>256)return null
  const hash=await digest(token)
  const {data:s,error}=await db.from('animestream_sessions').select('account_id').eq('token_hash',hash).gt('expires_at',new Date().toISOString()).maybeSingle()
  if(error||!s)return null
  const {data:u,error:e}=await db.from('animestream_accounts').select('id,email,display_name').eq('id',s.account_id).maybeSingle()
  return e||!u?null:{user:u,tokenHash:hash}
}
async function member(roomId:string,userId:string) {
  const {data:room,error:roomError}=await db.from('animestream_watch_rooms').select('status,expires_at').eq('id',roomId).maybeSingle()
  if(roomError||!room||room.status!=='active'||new Date(room.expires_at).getTime()<=Date.now())return null
  const {data,error}=await db.from('animestream_watch_room_members').select('role,left_at').eq('room_id',roomId).eq('account_id',userId).maybeSingle()
  if(error||!data||data.left_at)return null
  // A suspended mobile tab may miss heartbeats; only an explicit leave revokes membership.
  return data
}
async function ping(topic:string,revision:number,kind:string) {
  // Realtime is only a wake-up signal. Room data is re-fetched through this API;
  // clients never trust broadcast payloads as commands or chat content.
  try { await fetch(`${URL}/realtime/v1/api/broadcast`, { method:'POST', headers:{ apikey:SERVICE, Authorization:`Bearer ${SERVICE}`, 'Content-Type':'application/json' }, body:JSON.stringify({messages:[{topic,event:'room_event',payload:{revision,kind}}]}) }) }
  catch(e) { console.warn('Realtime ping failed; polling remains available',e?.message||e) }
}
async function snapshot(roomId:string,userId:string) {
  const mine=await member(roomId,userId);if(!mine)return null
  const {data:r,error}=await db.from('animestream_watch_rooms').select('*').eq('id',roomId).maybeSingle()
  if(error||!r||r.status!=='active'||new Date(r.expires_at).getTime()<=Date.now())return null
  const {data:ms,error:me}=await db.from('animestream_watch_room_members').select('account_id,role,joined_at,last_seen_at').eq('room_id',roomId).is('left_at',null).gte('last_seen_at',new Date(Date.now()-60000).toISOString()).order('joined_at',{ascending:true})
  if(me)throw me
  const ids=(ms||[]).map((x:any)=>x.account_id)
  const {data:profiles,error:pe}=ids.length?await db.from('animestream_accounts').select('id,display_name').in('id',ids):{data:[],error:null}
  if(pe)throw pe
  const names=new Map((profiles||[]).map((x:any)=>[x.id,x.display_name]))
  const {data:chat,error:ce}=await db.from('animestream_watch_room_messages').select('id,sender_account_id,body,created_at').eq('room_id',roomId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(60)
  if(ce)throw ce
  return {
    room:{id:r.id,code:r.room_code,topic:r.channel_topic,status:r.status,host_account_id:r.host_account_id,media_type:r.media_type,media:r.media,playback_state:r.playback_state,position_seconds:Number(r.position_seconds||0),playback_updated_at:r.playback_updated_at,revision:Number(r.revision),created_at:r.created_at,expires_at:r.expires_at},
    members:(ms||[]).map((x:any)=>({account_id:x.account_id,name:names.get(x.account_id)||'AnimeStream member',role:x.role,joined_at:x.joined_at,last_seen_at:x.last_seen_at})),
    messages:(chat||[]).reverse().map((x:any)=>({id:x.id,sender_account_id:x.sender_account_id,name:names.get(x.sender_account_id)||'AnimeStream member',body:x.body,created_at:x.created_at})),
    me:{account_id:userId,role:mine.role}
  }
}
function validMedia(m:any) { return !!m && typeof m==='object' && !Array.isArray(m) && ['anime','movie','tv'].includes(String(m.type)) && typeof m.title==='string' && !!m.title.trim() && m.title.length<=240 }
async function bump(roomId:string,kind:string,changes:Record<string,unknown>={}) {
  if(Object.keys(changes).length){const {error}=await db.from('animestream_watch_rooms').update(changes).eq('id',roomId);if(error)throw error;}
  const {data,error}=await db.rpc('bump_animestream_watch_room_revision',{p_room_id:roomId})
  if(error)throw error
  if(!data)throw new Error('Room no longer exists.')
  await ping(data.channel_topic,Number(data.revision),kind)
  return data
}
Deno.serve(async req=>{
  const origin=req.headers.get('origin')
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors(origin)})
  if(req.method!=='POST')return reply(req,{error:'Method not allowed.'},405)
  if(origin&&!allowed(origin))return reply(req,{error:'Origin not allowed.'},403)
  try{
    const raw=await req.text();if(raw.length>100000)return reply(req,{error:'Request too large.'},413)
    let b:any;try{b=JSON.parse(raw||'{}')}catch{return reply(req,{error:'Invalid request.'},400)}
    const session=await auth(req);if(!session)return reply(req,{error:'Please sign in again to use Watch Rooms.'},401)
    const uid=session.user.id,action=String(b.action||'')

    if(action==='create_room'){
      if(!validMedia(b.media))return reply(req,{error:'Open an anime, movie or series before creating a room.'},400)
      const {count:hosted,error:hostedError}=await db.from('animestream_watch_rooms').select('id',{count:'exact',head:true}).eq('host_account_id',uid).eq('status','active').gt('expires_at',new Date().toISOString())
      if(hostedError)throw hostedError
      if((hosted||0)>0)return reply(req,{error:'You already host an active room. End it before creating another.'},409)
      await db.from('animestream_watch_rooms').delete().lt('expires_at',new Date(Date.now()-24*60*60*1000).toISOString())
      let room:any=null
      for(let i=0;i<5&&!room;i++){
        const {data,error}=await db.from('animestream_watch_rooms').insert({room_code:code(),channel_topic:`watch-room:${random(24)}`,host_account_id:uid,media_type:b.media.type,media:b.media,position_seconds:Math.max(0,Math.min(86400,Number(b.media.position_seconds)||0)),playback_state:b.media.playback_state==='playing'?'playing':'paused',playback_updated_at:new Date().toISOString()}).select('id,revision').single()
        if(!error)room=data;else if(error.code!=='23505')throw error
      }
      if(!room)return reply(req,{error:'Could not reserve a room code. Try again.'},503)
      const {error:memberError}=await db.from('animestream_watch_room_members').insert({room_id:room.id,account_id:uid,role:'host'})
      if(memberError){await db.from('animestream_watch_rooms').delete().eq('id',room.id);throw memberError}
      const data=await snapshot(room.id,uid);if(!data)throw new Error('Room created but could not be loaded.')
      await ping(data.room.topic,Number(room.revision),'created')
      return reply(req,data,201)
    }

    if(action==='join_room'){
      const ip=(req.headers.get('x-forwarded-for')||req.headers.get('cf-connecting-ip')||'unknown').split(',')[0].trim()
      const joinKey=await digest('room-join:'+uid+':'+ip)
      const {data:joinAllowed,error:joinLimitError}=await db.rpc('consume_animestream_auth_attempt',{p_key_hash:joinKey,p_limit:20,p_window_seconds:600})
      if(joinLimitError)throw joinLimitError
      if(joinAllowed!==true)return reply(req,{error:'Too many room-code attempts. Wait a few minutes and try again.'},429)
      const c=String(b.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8)
      if(c.length!==8)return reply(req,{error:'Enter the 8-character room code.'},400)
      const {data:r,error}=await db.from('animestream_watch_rooms').select('id,channel_topic,revision').eq('room_code',c).eq('status','active').gt('expires_at',new Date().toISOString()).maybeSingle()
      if(error)throw error;if(!r)return reply(req,{error:'That room does not exist or has ended.'},404)
      const {data:j,error:je}=await db.rpc('join_animestream_watch_room',{p_room_id:r.id,p_account_id:uid})
      if(je)throw je;if(!j?.ok)return reply(req,{error:j?.reason==='full'?'This room already has 4 members.':'That room has ended.'},j?.reason==='full'?409:410)
      await bump(r.id,'member_joined')
      const data=await snapshot(r.id,uid);if(!data)return reply(req,{error:'This room has ended.'},410)
      return reply(req,data)
    }

    if(action==='get_room'||action==='heartbeat'){
      const id=String(b.room_id||'');if(!/^[0-9a-f-]{36}$/i.test(id))return reply(req,{error:'Room not found.'},404)
      if(!await member(id,uid))return reply(req,{error:'You are not a member of this room.'},403)
      const now=new Date().toISOString()
      if(action==='heartbeat'){
        const {data:before,error:beforeError}=await db.from('animestream_watch_rooms').select('host_account_id').eq('id',id).single()
        if(beforeError)throw beforeError
        await db.from('animestream_watch_room_members').update({last_seen_at:now}).eq('room_id',id).eq('account_id',uid)
        const {error:reconcileError}=await db.rpc('join_animestream_watch_room',{p_room_id:id,p_account_id:uid})
        if(reconcileError)throw reconcileError
        const {data:after,error:afterError}=await db.from('animestream_watch_rooms').select('host_account_id').eq('id',id).single()
        if(afterError)throw afterError
        await db.from('animestream_watch_rooms').update({last_activity_at:now,expires_at:new Date(Date.now()+6*60*60*1000).toISOString()}).eq('id',id)
        if(before.host_account_id!==after.host_account_id)await bump(id,'host_changed')
        const fresh=await snapshot(id,uid);return fresh?reply(req,fresh):reply(req,{error:'This room has ended.'},410)
      }
      await db.from('animestream_watch_room_members').update({last_seen_at:now}).eq('room_id',id).eq('account_id',uid)
      const data=await snapshot(id,uid);return data?reply(req,data):reply(req,{error:'This room has ended.'},410)
    }

    if(action==='send_message'){
      const id=String(b.room_id||'');if(!await member(id,uid))return reply(req,{error:'You are not a member of this room.'},403)
      const body=String(b.body||'').trim();if(!body)return reply(req,{error:'Write a message first.'},400);if(body.length>500)return reply(req,{error:'Messages must be 500 characters or fewer.'},400)
      const since=new Date(Date.now()-10000).toISOString()
      const {count,error:countError}=await db.from('animestream_watch_room_messages').select('id',{count:'exact',head:true}).eq('room_id',id).eq('sender_account_id',uid).gt('created_at',since)
      if(countError)throw countError;if((count||0)>=8)return reply(req,{error:'Slow down a little before sending another message.'},429)
      const {data:m,error}=await db.from('animestream_watch_room_messages').insert({room_id:id,sender_account_id:uid,body}).select('id,body,created_at').single();if(error)throw error
      const {count:total,error:te}=await db.from('animestream_watch_room_messages').select('id',{count:'exact',head:true}).eq('room_id',id);if(te)throw te
      if((total||0)>500){const {data:old,error:oe}=await db.from('animestream_watch_room_messages').select('id').eq('room_id',id).order('created_at',{ascending:true}).order('id',{ascending:true}).limit((total||0)-500);if(oe)throw oe;if(old?.length)await db.from('animestream_watch_room_messages').delete().in('id',old.map((x:any)=>x.id))}
      const bumped=await bump(id,'message')
      return reply(req,{message:{...m,sender_account_id:uid,name:session.user.display_name||'AnimeStream member'},revision:bumped.revision})
    }

    if(action==='progress'){
      const id=String(b.room_id||''),who=await member(id,uid);if(!who)return reply(req,{error:'You are not a member of this room.'},403)
      if(who.role!=='host')return reply(req,{error:'Only the host can update playback position.'},403)
      const position=Number(b.position_seconds??0)
      if(!Number.isFinite(position)||position<0||position>86400)return reply(req,{error:'Invalid playback position.'},400)
      const playbackState=b.playback_state==='playing'?'playing':'paused',now=new Date().toISOString()
      const bumped=await bump(id,'progress',{position_seconds:position,playback_state:playbackState,playback_updated_at:now})
      return reply(req,{ok:true,revision:bumped.revision,playback_updated_at:now})
    }

    if(action==='control'){
      const id=String(b.room_id||''),who=await member(id,uid);if(!who)return reply(req,{error:'You are not a member of this room.'},403)
      if(who.role!=='host')return reply(req,{error:'Only the host can control playback.'},403)
      const {data:r,error}=await db.from('animestream_watch_rooms').select('revision,playback_state').eq('id',id).single();if(error)throw error
      const kind=String(b.kind||''),now=new Date().toISOString(),changes:any={playback_updated_at:now}
      if(['play','pause','seek'].includes(kind)){
        const position=Number(b.position_seconds??0);if(!Number.isFinite(position)||position<0||position>86400)return reply(req,{error:'Invalid playback position.'},400)
        changes.position_seconds=position
        changes.playback_state=kind==='play'?'playing':kind==='pause'?'paused':(b.playback_state==='playing'?'playing':r.playback_state)
      }else if(kind==='episode'){
        if(!validMedia(b.media))return reply(req,{error:'Invalid room episode.'},400)
        changes.media=b.media;changes.media_type=b.media.type;changes.position_seconds=0;changes.playback_state='paused'
      }else return reply(req,{error:'Unknown playback command.'},400)
      const bumped=await bump(id,kind,changes)
      return reply(req,{ok:true,revision:bumped.revision,playback_updated_at:now})
    }

    if(action==='leave_room'||action==='end_room'){
      const id=String(b.room_id||''),who=await member(id,uid);if(!who)return reply(req,{ok:true})
      if(action==='end_room'&&who.role!=='host')return reply(req,{error:'Only the host can end this room.'},403)
      const now=new Date().toISOString();await db.from('animestream_watch_room_members').update({left_at:now}).eq('room_id',id).eq('account_id',uid)
      const {data:r,error}=await db.from('animestream_watch_rooms').select('host_account_id,channel_topic,revision').eq('id',id).single();if(error)throw error
      if(action==='end_room'){
        await db.from('animestream_watch_rooms').update({status:'ended'}).eq('id',id)
        await bump(id,'ended')
      }else if(r.host_account_id===uid){
        const {data:next}=await db.from('animestream_watch_room_members').select('account_id').eq('room_id',id).is('left_at',null).gte('last_seen_at',new Date(Date.now()-60000).toISOString()).order('joined_at',{ascending:true}).limit(1).maybeSingle()
        if(next?.account_id){await db.from('animestream_watch_room_members').update({role:'member'}).eq('room_id',id).eq('account_id',uid);await db.from('animestream_watch_room_members').update({role:'host'}).eq('room_id',id).eq('account_id',next.account_id);await db.from('animestream_watch_rooms').update({host_account_id:next.account_id}).eq('id',id);await bump(id,'host_changed')}
        else {await db.from('animestream_watch_rooms').update({status:'ended'}).eq('id',id);await bump(id,'ended')}
      }
      if(action==='leave_room'&&r.host_account_id!==uid)await bump(id,'member_left')
      return reply(req,{ok:true})
    }
    return reply(req,{error:'Unknown room action.'},400)
  }catch(e){console.error('rooms-api error',e?.message||e);return reply(req,{error:'The Rooms service is temporarily unavailable. Please try again.'},500)}
})
