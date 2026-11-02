export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');

  const tmdb = (req.query.tmdb || '').toString().replace(/[^\d]/g, '');
  const imdb = (req.query.imdb || '').toString().replace(/[^a-z0-9]/gi, '');

  if (!tmdb && !imdb) {
    res.status(400).json({ error: 'tmdb or imdb required' });
    return;
  }

  try {
    // IMDb posters are served directly by MetaHub (hotlink-friendly).
    if (imdb) {
      res.redirect(302, `https://images.metahub.space/poster/medium/${imdb}/img`);
      return;
    }

    const pageUrl = `https://www.themoviedb.org/movie/${tmdb}`;
    const html = await fetch(pageUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    }).then((r) => r.text());

    const m =
      html.match(/property="og:image" content="([^"]+)"/) ||
      html.match(/name="twitter:image" content="([^"]+)"/);

    if (!m || !m[1] || !m[1].startsWith('http')) {
      res.status(404).end();
      return;
    }

    // Stream the bytes ourselves so a hotlink block on the image CDN cannot blank the card.
    const img = await fetch(m[1], {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/avif,image/webp,image/*,*/*' },
    });
    if (!img.ok) {
      res.status(404).end();
      return;
    }
    const buf = Buffer.from(await img.arrayBuffer());
    res.setHeader('Content-Type', img.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
