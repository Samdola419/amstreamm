// Vercel serverless function: MegaPlay shield (port of server3.js, the proven version).
// vercel.json rewrites /mgpx/*, /mgpx-media/ and MegaPlay's bare /lib /stream /images paths here.
//   ?__p=/path  -> page / API / static mirror of megaplay.buzz
//   ?__m=1&u=.. -> media relay (manifests, segments, subtitles, sprites) with the MegaPlay referer
import { Readable } from 'node:stream';

const UP = 'https://megaplay.buzz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MEDIA_REFERER = 'https://megaplay.buzz/';

const hookScript = '<script>' +
  '(function(){' +
  'var RE=/^https?:\\/\\/[^\\/]+\\/(?:anime|movie|tv|series)\\//;' +
  'function px(u){return "/mgpx-media/?u=" + encodeURIComponent(u);}' +
  'function fix(u){if(typeof u!=="string")return u;if(u.indexOf("/mgpx-media/")===0)return u;if(u.indexOf(location.origin)===0)return u;if(RE.test(u))return px(u);return u;}' +
  'var of=window.fetch;if(of){window.fetch=function(i,s){if(typeof i==="string")i=fix(i);else if(i&&typeof i==="object"&&i.url){var r=fix(i.url);if(r!==i.url)i=new Request(r,i)}return of.call(this,i,s)};}' +
  'var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){if(arguments[1]!==undefined)arguments[1]=fix(String(arguments[1]));return oo.apply(this,arguments)};' +
  'window.MegaPlayMediaProxy={api:px,fix:fix};' +
  '})();' +
  '<\/script>';

function removeInlineScript(html, marker) {
  const idx = html.indexOf(marker);
  if (idx === -1) return html;
  const start = html.lastIndexOf('<script', idx);
  const end = html.indexOf('</script>', idx);
  if (start === -1 || end === -1) return html;
  return html.slice(0, start) + html.slice(end + '</script>'.length);
}
function rewriteMediaUrl(s) {
  return s.replace(/https:\/\/([a-z0-9.-]+)\/((?:anime|movie|tv|series)\/[^\s"'<>\\)]+)/gi, (m, host, rest) =>
    '/mgpx-media/?u=' + encodeURIComponent('https://' + host + '/' + rest));
}
function rewriteText(s) {
  return s
    .replace(/https:\\\/\\\/megaplay\.buzz/g, '\\\/mgpx')
    .replace(/https:\/\/megaplay\.buzz/g, '/mgpx');
}
function mpMissProbe() {
  return '(function(){var marks=["not available","no source","no results","no episode","no stream available","could not find","does not exist","doesn\'t exist","something went wrong","error code: 404","title not found","content not found","no servers"];function txt(){try{return (document.body?document.body.innerText:"").toLowerCase()}catch(e){return ""}}function scan(){var t=txt();if(!t)return false;for(var i=0;i<marks.length;i++){if(t.indexOf(marks[i])>=0)return true}return false}var hit=false;function run(){if(hit)return;if(scan()){hit=true;try{parent.postMessage({type:"mp-miss"},"*")}catch(e){}}}[3000,7000,13000].forEach(function(d){setTimeout(run,d)})})();';
}
function transformHTML(html) {
  html = removeInlineScript(html, '__MegaCdnHealthEarly');
  html = html.replace(/<script[^>]*app\.main\.js[^>]*>\s*<\/script>\s*/gi, '');
  html = html.replace(/<script[^>]*statlytic\.net[^>]*>\s*<\/script>\s*/gi, '');
  html = html.replace(/<script[^>]*cloudflareinsights\.com[^>]*>\s*<\/script>\s*/gi, '');
  html = html.replace(/<\/body>/i, '<script>' + mpMissProbe() + '<\/script></body>');
  html = rewriteText(html);
  const m = /<head[^>]*>/i.exec(html);
  const insertAt = m ? m.index + m[0].length : 0;
  return html.slice(0, insertAt) + hookScript + html.slice(insertAt);
}
function rewriteM3U8(body, baseUrl) {
  return body.split('\n').map(line => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) return rewriteMediaUrl(line);
    if (/^https?:\/\//i.test(t)) return rewriteMediaUrl(t);
    try { return '/mgpx-media/?u=' + encodeURIComponent(new URL(t, baseUrl).href); }
    catch (e) { return line; }
  }).join('\n');
}
function rewriteVTT(text, base) {
  return text.split('\n').map(line => {
    const t = line.trim();
    if (!t || /^(﻿)?\d+:\d+:\d+/.test(t) || t.startsWith('#') || t.startsWith('WEBVTT') || t.startsWith('NOTE')) return line;
    const mi = t.search(/[#\s]/);
    const pathPart = mi >= 0 ? t.slice(0, mi) : t;
    const rest = mi >= 0 ? t.slice(mi) : '';
    if (/\.(jpe?g|webp|png)(\?|$)/i.test(pathPart) || /^[^?#\/]*\/[^?#]*\.(jpe?g|webp|png)/i.test(pathPart)) {
      try {
        const abs = /^https?:\/\//i.test(pathPart) ? pathPart : new URL(pathPart, base).href;
        return '/mgpx-media/?u=' + encodeURIComponent(abs) + rest;
      } catch (e) { return line; }
    }
    return line;
  }).join('\n');
}

const one = v => Array.isArray(v) ? v[0] : v;

// Not an open proxy: https only, public hostnames only, and only the media paths MegaPlay's own
// player uses (/anime /movie /tv /series) or megaplay.buzz itself.
function mediaAllowed(u) {
  let x;
  try { x = new URL(u); } catch (e) { return false; }
  if (x.protocol !== 'https:') return false;
  const h = x.hostname.toLowerCase();
  if (!h.includes('.') || h.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || /\.(local|internal|localhost)$/.test(h)) return false;
  return /^\/(anime|movie|tv|series)\//i.test(x.pathname) || h === 'megaplay.buzz' || h.endsWith('.megaplay.buzz');
}

async function media(req, res) {
  const u = String(one(req.query?.u) || '');
  if (!/^https?:\/\//i.test(u)) return res.status(400).send('bad url');
  if (!mediaAllowed(u)) return res.status(403).send('host not allowed');
  const headers = { 'User-Agent': UA, 'Referer': MEDIA_REFERER, 'Accept': '*/*' };
  if (req.headers['range']) headers['Range'] = req.headers['range'];
  const up = await fetch(u, { headers, redirect: 'follow' }).catch(() => null);
  if (!up) return res.status(502).send('media proxy error');
  const ct = (up.headers.get('content-type') || '').toLowerCase();
  const len = Number(up.headers.get('content-length') || 0);
  const ok = up.status >= 200 && up.status < 300;
  // Manifests and subtitle files are small: buffer + sniff + rewrite. Big files (video segments) stream through.
  if (ok && up.status === 200 && (!len || len < 1500000)) {
    const buf = Buffer.from(await up.arrayBuffer());
    const head = buf.slice(0, 7).toString('utf8');
    const isM3u8 = head.startsWith('#EXTM3U') || /m3u8|vnd\.apple/.test(ct);
    const isVtt = head.startsWith('WEBVTT') || head.startsWith('﻿WEBVTT');
    if (isM3u8 || isVtt) {
      const base = u.split('#')[0];
      const text = buf.toString('utf8');
      res.setHeader('content-type', isM3u8 ? 'application/vnd.apple.mpegurl' : 'text/vtt');
      res.setHeader('cache-control', 'no-store');
      return res.status(200).send(isM3u8 ? rewriteM3U8(text, base) : rewriteVTT(text, base));
    }
    if (ct) res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'no-store');
    return res.status(200).send(buf);
  }
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = up.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.setHeader('cache-control', 'no-store');
  res.status(up.status);
  if (!up.body) return res.end();
  Readable.fromWeb(up.body).on('error', () => res.end()).pipe(res);
}

async function page(req, res) {
  const p = String(one(req.query?.__p) || '/');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k === '__p' || k === '__m') continue;
    (Array.isArray(v) ? v : [v]).forEach(x => qs.append(k, x));
  }
  const q = qs.toString();
  const target = UP + (p.startsWith('/') ? p : '/' + p) + (q ? '?' + q : '');
  const isDoc = /\/stream\/(mal|ani|s-2|sm)\//.test(target);
  const fh = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': MEDIA_REFERER,
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': isDoc ? 'navigate' : 'cors',
    'Sec-Fetch-Dest': isDoc ? 'iframe' : 'empty'
  };
  if (req.headers['x-requested-with']) fh['X-Requested-With'] = req.headers['x-requested-with'];
  const init = { headers: fh, redirect: 'follow', method: req.method };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body != null) {
    init.body = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
    if (req.headers['content-type']) fh['Content-Type'] = req.headers['content-type'];
  }
  let up = await fetch(target, init).catch(() => null);
  // MegaPlay sometimes answers server-to-server player-page requests with its own 404 page.
  // Retry the page with other header sets (browser-like navigation) before giving up.
  if (isDoc && req.method === 'GET' && up && (up.status === 404 || up.status === 403)) {
    const variants = [
      { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Upgrade-Insecure-Requests': '1' },
      { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': MEDIA_REFERER, 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe' },
      { 'User-Agent': UA, 'Accept': '*/*', 'Referer': 'https://' + (req.headers.host || 'localhost') + '/' }
    ];
    for (const h of variants) {
      const r = await fetch(target, { headers: h, redirect: 'follow' }).catch(() => null);
      if (r && r.status < 400) { up = r; break; }
    }
  }
  if (!up) return res.status(502).send('proxy error');
  const ct = (up.headers.get('content-type') || 'application/octet-stream').split(';')[0].toLowerCase();
  const textual = /^(text\/html|text\/css|text\/javascript|application\/javascript|application\/x-javascript|application\/json|text\/plain)/.test(ct);
  if (!textual) {
    res.setHeader('content-type', ct);
    return res.status(up.status).send(Buffer.from(await up.arrayBuffer()));
  }
  let body = await up.text();
  if (ct === 'text/html') body = transformHTML(body);
  else {
    body = ct === 'application/json' ? rewriteMediaUrl(body.replace(/\\\//g, '/')) : rewriteMediaUrl(body);
    body = rewriteText(body);
  }
  res.setHeader('content-type', ct + (ct === 'text/html' ? '; charset=utf-8' : ''));
  res.status(up.status).send(body);
}

// Open  https://<your-site>/mgpx-dbg  in a browser: shows what MegaPlay returns to Vercel.
async function debugReport(res) {
  const probes = [
    ['page, MegaPlay-style headers', UP + '/stream/mal/21/1/sub', { 'User-Agent': UA, 'Referer': MEDIA_REFERER, 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin' }],
    ['page, browser-like headers, no referer', UP + '/stream/mal/21/1/sub', { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Upgrade-Insecure-Requests': '1' }],
    ['page by AniList id', UP + '/stream/ani/21/1/sub', { 'User-Agent': UA, 'Referer': MEDIA_REFERER }],
    ['site root', UP + '/', { 'User-Agent': UA }]
  ];
  let out = 'MegaPlay shield debug (Vercel)\n==============================\n';
  for (const [name, u, h] of probes) {
    out += '\n## ' + name + '\n' + u + '\n';
    try {
      const r = await fetch(u, { headers: h, redirect: 'follow' });
      const body = (await r.text()).replace(/\s+/g, ' ');
      out += 'status: ' + r.status + '\n';
      for (const k of ['content-type', 'server', 'cf-ray', 'cf-mitigated', 'location']) if (r.headers.get(k)) out += k + ': ' + r.headers.get(k) + '\n';
      out += 'body: ' + body.slice(0, 500) + '\n';
    } catch (e) { out += 'ERROR: ' + String(e).slice(0, 200) + '\n'; }
  }
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  return res.status(200).send(out);
}

export default async function handler(req, res) {
  try {
    if (one(req.query?.__dbg)) return await debugReport(res);
    if (one(req.query?.__m)) return await media(req, res);
    return await page(req, res);
  } catch (e) {
    res.status(502).send('proxy error');
  }
}
