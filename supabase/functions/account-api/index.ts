import { createClient } from 'npm:@supabase/supabase-js@2.110.9'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Missing Supabase server environment')

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const allowedOrigins = new Set([
  'https://www.amstream.site',
  'https://amstream.site',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])
const corsHeaders = (origin: string | null) => {
  const allowed = !!origin && (allowedOrigins.has(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin))
  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : 'https://www.amstream.site',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
function bytesToHex(bytes: Uint8Array) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') }
function hexToBytes(hex: string) { return new Uint8Array((hex.match(/.{1,2}/g) || []).map(x => parseInt(x, 16))) }
function randomHex(size: number) {
  const b = new Uint8Array(size); crypto.getRandomValues(b); return bytesToHex(b)
}
async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}
async function passwordHash(password: string, saltHex: string) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: 600000, hash: 'SHA-256' }, material, 256)
  return bytesToHex(new Uint8Array(bits))
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
function newToken() {
  const b = new Uint8Array(32); crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function cleanAccount(row: any) {
  return { id: row.id, email: row.email, display_name: row.display_name, created_at: row.created_at, last_login_at: row.last_login_at }
}
const emptyLibrary = () => ({ my_list: [], continue_watching: [], watch_progress: {}, manga_progress: {}, preferences: {}, updated_at: null })

async function rateLimit(req: Request, email: string, action: string) {
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim()
  const key = await sha256(`${action}:${email}:${ip}`)
  const { data, error } = await db.rpc('consume_animestream_auth_attempt', {
    p_key_hash: key,
    p_limit: action === 'signup' ? 5 : 12,
    p_window_seconds: action === 'signup' ? 3600 : 900,
  })
  if (error) throw error
  return data === true
}
async function createSession(accountId: string) {
  const token = newToken()
  const tokenHash = await sha256(token)
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await db.from('animestream_sessions').insert({ token_hash: tokenHash, account_id: accountId, expires_at: expiresAt })
  if (error) throw error
  return { token, expires_at: expiresAt }
}
async function authenticate(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token || token.length < 32 || token.length > 256) return null
  const tokenHash = await sha256(token)
  const { data: session, error } = await db.from('animestream_sessions')
    .select('account_id, expires_at')
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error || !session) return null
  const { data: account, error: accountError } = await db.from('animestream_accounts')
    .select('id,email,display_name,created_at,last_login_at')
    .eq('id', session.account_id).maybeSingle()
  if (accountError || !account) return null
  await db.from('animestream_sessions').update({ last_seen_at: new Date().toISOString() }).eq('token_hash', tokenHash)
  return { tokenHash, account }
}
async function readLibrary(accountId: string) {
  const { data, error } = await db.from('animestream_account_library')
    .select('my_list,continue_watching,watch_progress,manga_progress,preferences,updated_at')
    .eq('account_id', accountId).maybeSingle()
  if (error) throw error
  return data || emptyLibrary()
}
function validSnapshot(s: any) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false
  if (!Array.isArray(s.my_list) || !Array.isArray(s.continue_watching)) return false
  if (!s.watch_progress || typeof s.watch_progress !== 'object' || Array.isArray(s.watch_progress)) return false
  if (!s.manga_progress || typeof s.manga_progress !== 'object' || Array.isArray(s.manga_progress)) return false
  if (!s.preferences || typeof s.preferences !== 'object' || Array.isArray(s.preferences)) return false
  if (s.my_list.length > 300 || s.continue_watching.length > 60) return false
  return true
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405)
  if (origin) {
    const originOK = allowedOrigins.has(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
    if (!originOK) return json(req, { error: 'Origin not allowed.' }, 403)
  }

  try {
    const raw = await req.text()
    if (raw.length > 1_600_000) return json(req, { error: 'Request is too large.' }, 413)
    let body: any
    try { body = JSON.parse(raw || '{}') } catch { return json(req, { error: 'Invalid request.' }, 400) }
    const action = String(body.action || '')

    if (action === 'signup') {
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(req, { error: 'Enter a valid email address.' }, 400)
      if (password.length < 8 || password.length > 128) return json(req, { error: 'Use a password between 8 and 128 characters.' }, 400)
      if (!(await rateLimit(req, email, 'signup'))) return json(req, { error: 'Too many account attempts. Please try again later.' }, 429)
      const salt = randomHex(16)
      const hash = await passwordHash(password, salt)
      const displayName = String(body.display_name || email.split('@')[0]).trim().slice(0, 40) || 'AnimeStream member'
      const { data: account, error } = await db.from('animestream_accounts')
        .insert({ email, display_name: displayName, password_hash: hash, password_salt: salt })
        .select('id,email,display_name,created_at,last_login_at').single()
      if (error) {
        if (error.code === '23505') return json(req, { error: 'An account with this email already exists. Please sign in.' }, 409)
        throw error
      }
      try {
        const session = await createSession(account.id)
        const library = await readLibrary(account.id)
        return json(req, { account: cleanAccount(account), library, ...session }, 201)
      } catch (e) {
        await db.from('animestream_accounts').delete().eq('id', account.id)
        throw e
      }
    }

    if (action === 'signin') {
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      if (!email || !password) return json(req, { error: 'Enter your email and password.' }, 400)
      if (!(await rateLimit(req, email, 'signin'))) return json(req, { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' }, 429)
      const { data: account, error } = await db.from('animestream_accounts')
        .select('id,email,display_name,password_hash,password_salt,created_at,last_login_at')
        .eq('email', email).maybeSingle()
      if (error) throw error
      if (!account) return json(req, { error: 'Email or password is incorrect.' }, 401)
      const candidate = await passwordHash(password, account.password_salt)
      if (!safeEqual(candidate, account.password_hash)) return json(req, { error: 'Email or password is incorrect.' }, 401)
      await db.from('animestream_accounts').update({ last_login_at: new Date().toISOString() }).eq('id', account.id)
      const session = await createSession(account.id)
      const library = await readLibrary(account.id)
      return json(req, { account: cleanAccount({ ...account, last_login_at: new Date().toISOString() }), library, ...session })
    }

    if (action === 'session' || action === 'sync' || action === 'logout') {
      const auth = await authenticate(req)
      if (!auth) return json(req, { error: 'Your session has expired. Please sign in again.' }, 401)
      if (action === 'session') return json(req, { account: cleanAccount(auth.account), library: await readLibrary(auth.account.id) })
      if (action === 'sync') {
        if (!validSnapshot(body.library)) return json(req, { error: 'Saved library data is invalid.' }, 400)
        const row = {
          account_id: auth.account.id,
          my_list: body.library.my_list,
          continue_watching: body.library.continue_watching,
          watch_progress: body.library.watch_progress,
          manga_progress: body.library.manga_progress,
          preferences: body.library.preferences,
          updated_at: new Date().toISOString(),
        }
        const { data, error } = await db.from('animestream_account_library')
          .upsert(row, { onConflict: 'account_id' })
          .select('updated_at').single()
        if (error) throw error
        return json(req, { ok: true, updated_at: data.updated_at })
      }
      await db.from('animestream_sessions').delete().eq('token_hash', auth.tokenHash)
      return json(req, { ok: true })
    }

    return json(req, { error: 'Unknown action.' }, 400)
  } catch (error) {
    console.error('account-api error', error?.message || error)
    return json(req, { error: 'The account service is temporarily unavailable. Please try again.' }, 500)
  }
})
