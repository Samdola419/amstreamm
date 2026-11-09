// Zero-dependency local server with the same behaviour as production:
// real pages for every route, and the app shell for deep links (/play/..., /t/..., /room/CODE).
//   node server.js [port]        ->  http://localhost:3000
// (The /api/* functions are Vercel serverless functions and only run on Vercel / `vercel dev`.)
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = Number(process.argv[2]) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.vtt': 'text/vtt' };
const send = (res, file, status = 200) => {
  res.writeHead(status, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
};
http.createServer((req, res) => {
  let p; try { p = decodeURIComponent(req.url.split('?')[0]); } catch (_) { p = '/'; }
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  let target = file;
  try { if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html'); } catch (_) {}
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return send(res, target);
  if (fs.existsSync(file + '.html')) return send(res, file + '.html');          // /privacy-policy style clean URLs
  if (path.extname(p) && !p.endsWith('.html')) { res.writeHead(404); return res.end('Not found'); } // missing asset
  send(res, path.join(ROOT, 'index.html'));                                       // deep link -> app shell
}).listen(PORT, () => console.log('AnimeStream on http://localhost:' + PORT));
