// Vercel serverless function: /api/img?u=<cover url>
// MangaDex refuses cover images when the request comes from another website (it swaps in a "you can read this at MangaDex"
// placeholder). Fetching the cover on the server avoids that, and the browser only ever sees your own address.
const ALLOWED = /^https:\/\/uploads\.mangadex\.org\/covers\/[0-9a-f-]{36}\/[\w.-]+\.(jpg|jpeg|png|webp)$/i;

export default async function handler(req, res) {
  const u = String(req.query?.u || '');
  if (!ALLOWED.test(u)) return res.status(400).send('bad url'); // not an open proxy: covers only
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'AnimeStream/1.0 (https://www.amstream.site)' } });
    if (!r.ok) return res.status(r.status === 404 ? 404 : 502).end();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
    res.status(200).send(Buffer.from(await r.arrayBuffer()));
  } catch (_) {
    res.status(502).end();
  }
}
