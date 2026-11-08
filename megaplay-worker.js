/**
 * MegaPlay shield worker — mirrors megaplay.buzz, strips their banner-probe + ad engine,
 * relays their referer-locked media. Runs free on Cloudflare Workers.
 *
 * Endpoints:
 *   /mgpx/<anything>          -> megaplay.buzz mirror (page / API / static libs)
 *   /mgpx-media/?u=<absURL>   -> media relay (manifests, HLS segments, subtitles, sprites)
 *   /lib/* /stream/* /images/* /domains /check_domain.json (bare) -> mirror, for their relative refs
 *
 * Deploy: Cloudflare dashboard -> Workers & Pages -> Create Worker -> paste -> Deploy.
 * Then in megaplay.html set  WORKER_BASE = 'https://<your-worker>.workers.dev/mgpx'
 */

const UP = 'https://megaplay.buzz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MEDIA_REFERER = 'https://megaplay.buzz/';

const hookScript = '<script>' +
  '(function(){' +
  'var RE=/^https?:\\/\\/[^\\/]+\\/(?:anime|movie|tv|series)\\//;' +
  'function px(u){return "/mgpx-media/?u=" + encodeURIComponent(u);}' +
  'function fix(u){if(typeof u!=="string")return u;if(u.indexOf("/mgpx-media/")===0)return u;if(u.indexOf(location.origin)===0)return u;if(RE.test(u))return px(u);return u;}' +
  'var of=window.fetch;if(of){window.fetch=function(i,s){if(typeof i==="string")i=fix(i);else if(i&&typeof i==="object"&&i.url){var r=fix(i.url);if(r!==i.url)i=new Request(r,i)}return of.call(this,i,s)};}' +
  'var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){if(typeof arguments[1]==="string")arguments[1]=fix(arguments[1]);return oo.apply(this,arguments)};' +
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

function transformHTML(html) {
  html = removeInlineScript(html, '__MegaCdnHealthEarly');
  html = html.replace(/<script[^>]*app\.main\.js[^>]*>\s*<\/script>\s*/gi, '');
  html = html.replace(/<script[^>]*statlytic\.net[^>]*>\s*<\/script>\s*/gi, '');
  html = html.replace(/<script[^>]*cloudflareinsights\.com[^>]*>\s*<\/script>\s*/gi, '');
  // Miss probe: page text says there is nothing for this title -> tell the site to hop servers.
  html = html.replace(/<\/body>/i, '<script>' + mpMissProbe() + '<\/script></body>');
  html = rewriteText(html);
  const m = /<head[^>]*>/i.exec(html);
  const insertAt = m ? m.index + m[0].length : 0;
  return html.slice(0, insertAt) + hookScript + html.slice(insertAt);
}

// Injected into every mirrored player page: checks its own visible text a few
// times after boot; if the page is telling the viewer it has nothing for this
// title, posts one mp-miss message up so the site hops to the next server.
function mpMissProbe() {
  return '(function(){var marks=["not available","no source","no results","no episode","no stream available","could not find","does not exist","title not found","content not found","no servers"].map(function(x){return x});function txt(){try{return (document.body?document.body.innerText:"").toLowerCase()}catch(e){return ""}}function scan(){var t=txt();if(!t)return false;for(var i=0;i<marks.length;i++){if(t.indexOf(marks[i])>=0)return true}return false}var hit=false;function run(){if(hit)return;if(scan()){hit=true;try{parent.postMessage({type:"mp-miss"},"*")}catch(e){}}}[3000,7000,13000].forEach(function(d){setTimeout(run,d)})})();';
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

function rewriteVTT(text, baseUrl) {
  return text.split('\n').map(line => {
    const t = line.trim();
    if (!t || /^\d+:\d+:\d+/.test(t) || t.startsWith('#') || t.startsWith('WEBVTT') || t.startsWith('NOTE')) return line;
    const mi = t.search(/[#\s]/);
    const pathPart = mi >= 0 ? t.slice(0, mi) : t;
    const rest = mi >= 0 ? t.slice(mi) : '';
    if (/\.(jpe?g|webp|png)(\?|$)/i.test(pathPart)) {
      try {
        const abs = /^https?:\/\//i.test(pathPart) ? pathPart : new URL(pathPart, baseUrl).href;
        return '/mgpx-media/?u=' + encodeURIComponent(abs) + rest;
      } catch (e) { return line; }
    }
    return line;
  }).join('\n');
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);

    // ---------- media relay ----------
    if (path === '/mgpx-media/' || path === '/mgpx-media') {
      const u = url.searchParams.get('u') || '';
      if (!/^https?:\/\//i.test(u)) return new Response('bad url', { status: 400 });
      const headers = { 'User-Agent': UA, 'Referer': MEDIA_REFERER, 'Accept': '*/*' };
      const range = request.headers.get('range');
      if (range) headers['Range'] = range;
      const up = await fetch(u, { headers, redirect: 'follow' }).catch(e => null);
      if (!up) return new Response('media proxy error', { status: 502 });
      const ct = (up.headers.get('content-type') || '').toLowerCase();
      if (up.status === 200) {
        const isM3u8 = /m3u8|vnd\.apple/.test(ct) || (u.split('#')[0]).endsWith('.m3u8');
        const isVtt = /vtt/.test(ct) || u.includes('.vtt');
        if (isM3u8 || isVtt) {
          const text = await up.text();
          const base = u.split('#')[0];
          const body = isM3u8 ? rewriteM3U8(text, base) : rewriteVTT(text, base);
          return new Response(body, {
            status: 200,
            headers: { 'content-type': isM3u8 ? 'application/vnd.apple.mpegurl' : 'text/vtt', 'cache-control': 'no-store' }
          });
        }
      }
      const h = new Headers();
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const v = up.headers.get(k);
        if (v) h.set(k, v);
      }
      h.set('cache-control', 'no-store');
      return new Response(up.body, { status: up.status, headers: h });
    }

    // ---------- embed route ----------
    // Some browsers, extensions or networks treat third-party player pages as suspect and
    // re-point them seconds after load (the classic symptom is a black iframe). /mgpx-embed?u=
    // serves the SAME mirrored player, but from a plain page URL on OUR origin, so nothing out
    // there sees a naked third-party embed path to kick around. It is a real server route (the
    // upstream page is fetched and transformed below) — same behavior, same player.
    // The viewer-visible behavior is identical (skip intro, quality menu, next episode…).
    let target = null;
    if (path === '/mgpx-embed' || path.startsWith('/mgpx-embed/') || path.startsWith('/mgpx-embed?')) {
      const u = url.searchParams.get('u') || '';
      if (/^\/mgpx\/[A-Za-z0-9._~:/-]+(\?[A-Za-z0-9._%~:?&=+-]+)?$/.test(u)) {
        // serve the mirrored page directly at /mgpx-embed; drop the 'u' param from the inner query
        const inner = url.search.replace(/^[^&]*u=[^&]*&?/, '').replace(/^\?/, '');
        target = UP + u.slice('/mgpx'.length) + (inner ? '?' + inner : '');
      }
    }

    // ---------- page / API mirror ----------
    if (!target && (path === '/mgpx' || path.startsWith('/mgpx/'))) target = UP + url.pathname.slice('/mgpx'.length) + url.search;
    else if (!target && (/^\/(lib|stream|images)\//.test(path) || path === '/domains' || path.startsWith('/domains?') || path === '/check_domain.json')) target = UP + url.pathname + url.search;
    if (!target) return new Response('not found', { status: 404 });

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
    const xrq = request.headers.get('x-requested-with');
    if (xrq) fh['X-Requested-With'] = xrq;

    const up = await fetch(target, { headers: fh, redirect: 'follow', method: request.method, body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined }).catch(e => null);
    if (!up) return new Response('proxy error', { status: 502 });
    const ct = (up.headers.get('content-type') || 'application/octet-stream').split(';')[0].toLowerCase();
    const textual = /^(text\/html|text\/css|text\/javascript|application\/javascript|application\/x-javascript|application\/json|text\/plain)/.test(ct);
    if (!textual) {
      const h = new Headers(); h.set('content-type', ct);
      return new Response(up.body, { status: up.status, headers: h });
    }
    let body = await up.text();
    if (ct === 'text/html') body = transformHTML(body);
    else {
      if (ct === 'application/json') body = rewriteMediaUrl(body.replace(/\\\//g, '/'));
      else body = rewriteMediaUrl(body);
      body = rewriteText(body);
    }
    return new Response(body, {
      status: up.status,
      headers: { 'content-type': ct + (ct === 'text/html' ? '; charset=utf-8' : '') }
    });
  }
};
