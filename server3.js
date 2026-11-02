// Dev server: static files from ssdds + full strip-proxy for megaplay.buzz (port 8793).
// Layers:
//   1. /mgpx/<path>            -> page/static/API mirror of megaplay.buzz (strips app.main.js,
//                                 analytics, health probe; rewrites megaplay.buzz -> /mgpx)
//   2. /mgpx-media/?u=<absURL> -> media relay (video manifests/segments/subtitles/previews) with the
//                                 fake Attach Known referer (https://megaplay.buzz/) + Range pass-through
//   3. bare /lib/* /stream/* /images/* /domains /check_domain.json also mirror (relative refs)
// Serves the site itself on the same origin so the rehoused player is same-origin with megaplay.html.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || 'C:/Users/user/Desktop/ssdds';
const PORT = process.argv[3] || 8793;
const UP = 'https://megaplay.buzz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MEDIA_REFERER = 'https://megaplay.buzz/';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.vtt': 'text/vtt'
};

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

// Injected into every mirrored player page: checks its own visible text a few
// times after boot; if the page is telling the viewer it has nothing for this
// title, posts one mp-miss message up so the site hops to the next server.
function mpMissProbe() {
  return '(function(){var marks=["not available","no source","no results","no episode","no stream available","could not find","does not exist","title not found","content not found","no servers"].map(function(x){return x});function txt(){try{return (document.body?document.body.innerText:"").toLowerCase()}catch(e){return ""}}function scan(){var t=txt();if(!t)return false;for(var i=0;i<marks.length;i++){if(t.indexOf(marks[i])>=0)return true}return false}var hit=false;function run(){if(hit)return;if(scan()){hit=true;try{parent.postMessage({type:"mp-miss"},"*")}catch(e){}}}[3000,7000,13000].forEach(function(d){setTimeout(run,d)})})();';
}

function transformHTML(html) {
  html = removeInlineScript(html, '__MegaCdnHealthEarly');
  html = html.replace(/<script[^>]*app\.main\.js[^>]*>\s*<\/script>\s*/gi, '');
  html = html.replace(/<script[^>]*statlytic\.net[^>]*>\s*<\/script>\s*/gi, '');
  html = html.replace(/<script[^>]*cloudflareinsights\.com[^>]*>\s*<\/script>\s*/gi, '');
  // Miss probe: when the mirrored player page has nothing for this title, report
  // it to the site (parent) so it hops to the next server without a dead screen.
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
    if (t.startsWith('#')) {
      // keep tag, rewrite any absolute media URL inside attributes
      return rewriteMediaUrl(line);
    }
    if (/^https?:\/\//i.test(t)) return rewriteMediaUrl(t);
    // relative -> resolve against the original manifest URL, then wrap
    try { return '/mgpx-media/?u=' + encodeURIComponent(new URL(t, baseUrl).href); }
    catch (e) { return line; }
  }).join('\n');
}

const PROXY_STATIC_PREFIXES = ['/lib/', '/stream/', '/images/', '/domains', '/check_domain.json'];

http.createServer((req, res) => {
  const url = req.url;

  // ---- media relay ----
  if (url.startsWith('/mgpx-media/')) {
    const u = decodeURIComponent((new URL(url, 'http://x').searchParams.get('u') || ''));
    if (!/^https?:\/\//i.test(u)) { res.writeHead(400); return res.end('bad url'); }
    const headers = { 'User-Agent': UA, 'Referer': MEDIA_REFERER, 'Accept': '*/*' };
    if (req.headers['range']) headers['Range'] = req.headers['range'];
    fetch(u, { headers, redirect: 'follow' }).then(async (up) => {
      const buf = up.status >= 200 && up.status < 300 ? Buffer.from(await up.arrayBuffer()) : null;
      const ct = (up.headers.get('content-type') || '').toLowerCase();
      const head = buf ? buf.slice(0, 7).toString('utf8') : '';
      const isM3u8 = head.startsWith('#EXTM3U') || /m3u8|vnd\.apple/.test(ct);
      const isVtt = buf && (head.startsWith('WEBVTT') || head.startsWith('‎WEBVTT'));
      if (up.status >= 200 && up.status < 300 && (isM3u8 || isVtt)) {
        const base = u.split('#')[0];
        const text = buf.toString('utf8');
        let out;
        if (isM3u8) out = rewriteM3U8(text, base);
        else out = text.split('\n').map((line) => {
          const t = line.trim();
          if (!t || /^(\uFEFF)?\d+:\d+:\d+/.test(t) || t.startsWith('#') || t.startsWith('WEBVTT') || t.startsWith('NOTE')) return line;
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
        res.writeHead(up.status, { 'content-type': isM3u8 ? 'application/vnd.apple.mpegurl' : 'text/vtt', 'cache-control': 'no-store' });
        return res.end(out);
      }
      const hs = {};
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const v = up.headers.get(h);
        if (v) hs[h] = v;
      }
      hs['cache-control'] = 'no-store';
      res.writeHead(up.status, hs);
      if (buf) return res.end(buf);
      if (up.body) {
        const { Readable } = require('stream');
        Readable.fromWeb(up.body).pipe(res);
      } else res.end();
    }).catch((e) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('media proxy error: ' + String(e).slice(0, 200));
    });
    return;
  }

  // ---- megaplay page proxy ----
  let proxyPath = null;
  if (url.startsWith('/mgpx/')) proxyPath = url.slice('/mgpx'.length);
  else if (PROXY_STATIC_PREFIXES.some((p) => url === p.replace(/\/$/, '') || url.startsWith(p))) proxyPath = url;
  if (proxyPath) {
    const target = UP + proxyPath;
    const isDoc = /\/stream\/(mal|ani|s-2|sm)\//.test(target);
    const fetchHeaders = {
      'User-Agent': UA,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': MEDIA_REFERER,
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': isDoc ? 'navigate' : 'cors',
      'Sec-Fetch-Dest': isDoc ? 'iframe' : 'empty'
    };
    if (req.headers['x-requested-with']) fetchHeaders['X-Requested-With'] = req.headers['x-requested-with'];

    fetch(target, { headers: fetchHeaders, redirect: 'follow' }).then(async (up) => {
      const ct = (up.headers.get('content-type') || 'application/octet-stream').split(';')[0].toLowerCase();
      const textual = /^(text\/html|text\/css|text\/javascript|application\/javascript|application\/x-javascript|application\/json|text\/plain)/.test(ct);
      if (!textual) {
        const buf = Buffer.from(await up.arrayBuffer());
        res.writeHead(up.status, { 'content-type': ct });
        return res.end(buf);
      }
      let body = await up.text();
      if (ct === 'text/html') body = transformHTML(body);
      else {
        if (ct === 'application/json') body = rewriteMediaUrl(body.replace(/\\\//g, '/'));
        else body = rewriteMediaUrl(body);
        body = rewriteText(body);
      }
      res.writeHead(up.status, { 'content-type': ct + (ct === 'text/html' ? '; charset=utf-8' : '') });
      res.end(body);
    }).catch((e) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('proxy error: ' + String(e).slice(0, 200));
    });
    return;
  }

  // ---- static ----
  let p = decodeURIComponent(url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const data = fs.readFileSync(path.join(ROOT, p));
    res.writeHead(200, { 'content-type': types[path.extname(p).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch (e) {
    // clean-URL SPA fallback: app routes serve the shell (mirrors vercel.json rewrites)
    const appRoute = /^\/(?:play|t|anime|movies|series|genre|category|list|continue|coming|manga)(?:\/|$)/.test(p) && !path.extname(p);
    if (appRoute) {
      try {
        const shell = fs.readFileSync(path.join(ROOT, 'index.html'));
        res.writeHead(200, { 'content-type': types['.html'] });
        return res.end(shell);
      } catch (e2) {}
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
  }
}).listen(PORT, () => console.log('ssdds + megaplay full proxy on http://localhost:' + PORT));
