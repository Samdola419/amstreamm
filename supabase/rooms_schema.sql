import { createClient } from 'npm:@supabase/supabase-js@2.110.9'

const URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
if (!URL || !SERVICE) throw new Error('Missing Supabase server environment')

const db = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
})
const allowedOrigins = new Set([
  'https://www.amstream.site', 'https://amstream.site',
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:5173', 'http://127.0.0.1:5173'
])
const allowed = (origin: string | null) => !!origin && (
  allowedOrigins.has(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
)
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': allowed(origin) && origin ? origin : 'https://www.amstream.site',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin'
})
function reply(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(req.headers.get('origin')), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}
const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
async function sha256(value: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

function fromBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function verifyHostPlaybackPacket(publicKeyBase64: string, packet: Record<string, unknown>) {
  const signature = String(packet.signature || '')
  // P-256 WebCrypto signatures are 64-byte IEEE-P1363 values (88 Base64 chars).
  if (!/^[A-Za-z0-9+/]{80,120}={0,2}$/.test(signature)) return false
  const { signature: _signature, ...unsignedPacket } = packet
  try {
    const publicKey = await crypto.subtle.importKey(
      'spki', fromBase64(publicKeyBase64),
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    )
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, publicKey,
      fromBase64(signature), new TextEncoder().encode(JSON.stringify(unsignedPacket))
    )
  } catch (error) {
    console.warn('Host playback signature verification failed', error?.message || error)
    return false
  }
}
function randomToken(size = 24) {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('')
}

async function authenticate(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (token.length < 32 || token.length > 256) return null
  const tokenHash = await sha256(token)
  const { data: session, error: sessionError } = await db.from('animestream_sessions')
    .select('account_id').eq('token_hash', tokenHash).gt('expires_at', new Date().toISOString()).maybeSingle()
  if (sessionError || !session) return null
  const { data: user, error: userError } = await db.from('animestream_accounts')
    .select('id,email,display_name').eq('id', session.account_id).maybeSingle()
  return userError || !user ? null : { user, tokenHash }
}

async function getMembership(roomId: string, accountId: string) {
  const { data: room, error: roomError } = await db.from('animestream_watch_rooms')
    .select('status,expires_at').eq('id', roomId).maybeSingle()
  if (roomError || !room || room.status !== 'active' || new Date(room.expires_at).getTime() <= Date.now()) return null
  const { data, error } = await db.from('animestream_watch_room_members')
    .select('role,left_at').eq('room_id', roomId).eq('account_id', accountId).maybeSingle()
  return error || !data || data.left_at ? null : data
}

// The topic is a random, 192-bit capability handed only to validated room members.
// Broadcast payloads are server-originated, and all durable data remains behind this API.
async function broadcast(topic: string, payload: Record<string, unknown>) {
  try {
    const response = await fetch(`${URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messages: [{ topic, event: 'room_event', payload }] })
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      console.error('Realtime broadcast rejected', response.status, detail.slice(0, 400))
      return false
    }
    return true
  } catch (error) {
    console.error('Realtime broadcast failed', error?.message || error)
    return false
  }
}

async function snapshot(roomId: string, accountId: string) {
  const mine = await getMembership(roomId, accountId)
  if (!mine) return null
  const { data: room, error: roomError } = await db.from('animestream_watch_rooms')
    .select('*').eq('id', roomId).maybeSingle()
  if (roomError || !room || room.status !== 'active' || new Date(room.expires_at).getTime() <= Date.now()) return null

  const { data: members, error: membersError } = await db.from('animestream_watch_room_members')
    .select('account_id,role,joined_at,last_seen_at').eq('room_id', roomId).is('left_at', null)
    .gte('last_seen_at', new Date(Date.now() - 120000).toISOString()).order('joined_at', { ascending: true })
  if (membersError) throw membersError
  const memberIds = (members || []).map((member: any) => member.account_id)
  const { data: profiles, error: profilesError } = memberIds.length
    ? await db.from('animestream_accounts').select('id,display_name').in('id', memberIds)
    : { data: [], error: null }
  if (profilesError) throw profilesError
  const names = new Map((profiles || []).map((profile: any) => [profile.id, profile.display_name]))

  const { data: messages, error: messagesError } = await db.from('animestream_watch_room_messages')
    .select('id,sender_account_id,body,created_at').eq('room_id', roomId)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(60)
  if (messagesError) throw messagesError

  return {
    room: {
      id: room.id, code: room.room_code, topic: room.channel_topic, status: room.status,
      host_account_id: room.host_account_id, media_type: room.media_type, media: room.media,
      playback_state: room.playback_state, position_seconds: Number(room.position_seconds || 0),
      playback_updated_at: room.playback_updated_at, playback_seq: Number(room.playback_seq || 0),
      host_signing_public_key: room.host_signing_public_key || null, revision: Number(room.revision),
      created_at: room.created_at, expires_at: room.expires_at
    },
    members: (members || []).map((member: any) => ({
      account_id: member.account_id, name: names.get(member.account_id) || 'AnimeStream member',
      role: member.role, joined_at: member.joined_at, last_seen_at: member.last_seen_at
    })),
    messages: (messages || []).reverse().map((message: any) => ({
      id: message.id, sender_account_id: message.sender_account_id,
      name: names.get(message.sender_account_id) || 'AnimeStream member',
      body: message.body, created_at: message.created_at
    })),
    me: { account_id: accountId, role: mine.role }
  }
}

function validMedia(media: any) {
  return !!media && typeof media === 'object' && !Array.isArray(media) &&
    ['anime', 'movie', 'tv'].includes(String(media.type)) &&
    typeof media.title === 'string' && !!media.title.trim() && media.title.length <= 240
}

async function publishRoomEvent(roomId: string, kind: string, detail: Record<string, unknown> = {}) {
  const { data, error } = await db.rpc('bump_animestream_watch_room_revision', { p_room_id: roomId })
  if (error) throw error
  if (!data) throw new Error('Room no longer exists.')
  const payload = { room_id: roomId, kind, revision: Number(data.revision), ...detail }
  await broadcast(data.channel_topic, payload)
  return payload
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) })
  if (req.method !== 'POST') return reply(req, { error: 'Method not allowed.' }, 405)
  if (origin && !allowed(origin)) return reply(req, { error: 'Origin not allowed.' }, 403)

  try {
    const raw = await req.text()
    if (raw.length > 100000) return reply(req, { error: 'Request too large.' }, 413)
    let body: any
    try { body = JSON.parse(raw || '{}') } catch { return reply(req, { error: 'Invalid request.' }, 400) }
    const session = await authenticate(req)
    if (!session) return reply(req, { error: 'Please sign in again to use Watch Rooms.' }, 401)
    const accountId = session.user.id
    const action = String(body.action || '')

    if (action === 'create_room') {
      const signingPublicKey = String(body.host_signing_public_key || '')
      if (!/^[A-Za-z0-9+/]{40,400}={0,2}$/.test(signingPublicKey)) return reply(req, { error: 'Could not initialize secure room playback.' }, 400)
      if (!validMedia(body.media)) return reply(req, { error: 'Open an anime, movie or series before creating a room.' }, 400)
      const { count: hosted, error: hostedError } = await db.from('animestream_watch_rooms')
        .select('id', { count: 'exact', head: true }).eq('host_account_id', accountId)
        .eq('status', 'active').gt('expires_at', new Date().toISOString())
      if (hostedError) throw hostedError
      if ((hosted || 0) > 0) return reply(req, { error: 'You already host an active room. End it before creating another.' }, 409)

      await db.from('animestream_watch_rooms').delete().lt('expires_at', new Date().toISOString())
      let created: any = null
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        const { data, error } = await db.from('animestream_watch_rooms').insert({
          room_code: makeRoomCode(), channel_topic: `watch-room:${randomToken(24)}`,
          host_account_id: accountId, media_type: body.media.type, media: body.media,
          position_seconds: Math.max(0, Math.min(86400, Number(body.media.position_seconds) || 0)),
          playback_state: body.media.playback_state === 'playing' ? 'playing' : 'paused',
          playback_updated_at: new Date().toISOString(),
          host_signing_public_key: signingPublicKey
        }).select('id').single()
        if (!error) created = data
        else if (error.code !== '23505') throw error
      }
      if (!created) return reply(req, { error: 'Could not reserve a room code. Try again.' }, 503)
      const { error: memberError } = await db.from('animestream_watch_room_members').insert({
        room_id: created.id, account_id: accountId, role: 'host'
      })
      if (memberError) { await db.from('animestream_watch_rooms').delete().eq('id', created.id); throw memberError }
      const data = await snapshot(created.id, accountId)
      if (!data) throw new Error('Room created but could not be loaded.')
      return reply(req, data, 201)
    }

    if (action === 'join_room') {
      const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim()
      const joinKey = await sha256(`room-join:${accountId}:${ip}`)
      const { data: allowedJoin, error: limitError } = await db.rpc('consume_animestream_auth_attempt', {
        p_key_hash: joinKey, p_limit: 20, p_window_seconds: 600
      })
      if (limitError) throw limitError
      if (allowedJoin !== true) return reply(req, { error: 'Too many room-code attempts. Wait a few minutes and try again.' }, 429)
      const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
      if (code.length !== 8) return reply(req, { error: 'Enter the 8-character room code.' }, 400)
      const { data: room, error } = await db.from('animestream_watch_rooms').select('id').eq('room_code', code)
        .eq('status', 'active').gt('expires_at', new Date().toISOString()).maybeSingle()
      if (error) throw error
      if (!room) return reply(req, { error: 'That room does not exist or has ended.' }, 404)
      const { data: joined, error: joinError } = await db.rpc('join_animestream_watch_room', {
        p_room_id: room.id, p_account_id: accountId
      })
      if (joinError) throw joinError
      if (!joined?.ok) return reply(req,
        { error: joined?.reason === 'full' ? 'This room already has 4 members.' : 'That room has ended.' },
        joined?.reason === 'full' ? 409 : 410)
      await publishRoomEvent(room.id, 'member_changed')
      const data = await snapshot(room.id, accountId)
      return data ? reply(req, data) : reply(req, { error: 'This room has ended.' }, 410)
    }

    if (action === 'set_host_signing_key') {
      const roomId = String(body.room_id || '')
      const member = -- Atomic playback snapshot + revision. Pause remains authoritative until explicit Play.
drop function if exists public.update_animestream_watch_room_playback(uuid,numeric,text,timestamptz,jsonb,text,boolean,bigint);
drop function if exists public.update_animestream_watch_room_playback(uuid,numeric,text,timestamptz,jsonb,text,boolean,bigint,boolean);

create or replace function public.update_animestream_watch_room_playback(
  p_room_id uuid,
  p_position_seconds numeric,
  p_playback_state text,
  p_playback_updated_at timestamptz,
  p_media jsonb,
  p_media_type text,
  p_position_only boolean,
  p_playback_seq bigint,
  p_allow_resume boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_topic text; v_revision bigint; v_seq bigint;
begin
  if p_playback_state not in ('playing','paused') then raise exception 'Invalid playback state'; end if;
  if p_position_seconds is null or p_position_seconds < 0 or p_position_seconds > 86400 then raise exception 'Invalid playback position'; end if;
  if p_playback_seq is null or p_playback_seq < 1 then raise exception 'Invalid playback sequence'; end if;
  update public.animestream_watch_rooms set
    position_seconds=p_position_seconds,
    playback_state=p_playback_state,
    playback_updated_at=p_playback_updated_at,
    media=coalesce(p_media,media),
    media_type=coalesce(p_media_type,media_type),
    playback_seq=p_playback_seq,
    revision=revision+1,
    last_activity_at=pg_catalog.now(),
    expires_at=pg_catalog.now()+interval '6 hours'
  where id=p_room_id and status='active' and expires_at>pg_catalog.now()
    and p_playback_seq>playback_seq
    -- A position-only checkpoint never changes a paused room to playing.
    and (not p_position_only or (playback_state='playing' and p_playback_state='playing'))
    -- Only an explicit Play command may transition paused -> playing.
    and (playback_state<>'paused' or p_playback_state<>'playing' or coalesce(p_allow_resume,false))
  returning channel_topic,revision,playback_seq into v_topic,v_revision,v_seq;
  if not found then return null; end if;
  return jsonb_build_object('channel_topic',v_topic,'revision',v_revision,'playback_seq',v_seq);
end;
$$;
revoke all on function public.update_animestream_watch_room_playback(uuid,numeric,text,timestamptz,jsonb,text,boolean,bigint,boolean) from public,anon,authenticated;
grant execute on function public.update_animestream_watch_room_playback(uuid,numeric,text,timestamptz,jsonb,text,boolean,bigint,boolean) to service_role;
