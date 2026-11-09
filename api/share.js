// Vercel serverless function: /api/share?t=anime|movie|tv&id=...
// Chat apps (WhatsApp, Telegram, iMessage, X, Discord) read the og: tags below to build the link preview,
// so the shared link shows the title's poster. People who open it are sent straight to the title's page.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const https = u => String(u || '').replace(/^http:\/\//i, 'https://');

async function load(type, id) {
  if (type === 'anime') {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: 'query($id:Int){Media(id:$id,type:ANIME){title{romaji english} description(asHtml:false) coverImage{extraLarge large} seasonYear}}',
        variables: { id: Number(id) }
      })
    });
    const m = (await r.json())?.data?.Media;
    if (!m) return null;
    return { title: m.title.english || m.title.romaji, desc: strip(m.description), image: m.coverImage.extraLarge || m.coverImage.large, year: m.seasonYear };
  }
  if (type === 'movie') {
    const r = await fetch(`https://v3-cinemeta.strem.io/meta/movie/${encodeURIComponent(id)}.json`);
    const m = (await r.json())?.meta;
    if (!m) return null;
    return { title: m.name, desc: strip(m.description), image: m.poster || `https://images.metahub.space/poster/large/${id}/img`, year: m.year || String(m.released || '').slice(0, 4) };
  }
  if (type === 'manga') {
    const r = await fetch(`https://api.mangadex.org/manga/${encodeURIComponent(id)}?includes[]=cover_art`, { headers: { 'User-Agent': 'AnimeStream/1.0' } });
    const d = (await r.json())?.data;
    if (!d) return null;
    const a = d.attributes || {};
    const f = (d.relationships || []).find(x => x.type === 'cover_art')?.attributes?.fileName;
    return { title: a.title?.en || Object.values(a.title || {})[0], desc: strip((a.description?.en || '').split(/\n\s*---/)[0]), image: f ? `https://uploads.mangadex.org/covers/${id}/${f}.512.jpg` : '', year: a.year };
  }
  if (type === 'comic') {
    const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`);
    const m = (await r.json())?.metadata;
    if (!m) return null;
    const f = v => Array.isArray(v) ? v[0] : v;
    return { title: strip(f(m.title)), desc: strip(f(m.description)), image: `https://archive.org/services/img/${id}`, year: String(f(m.date) || '').slice(0, 4) };
  }
  if (type === 'tv') {
    const r = await fetch(`https://api.tvmaze.com/shows/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    const s = await r.json();
    return { title: s.name, desc: strip(s.summary), image: s.image?.original || s.image?.medium, year: (s.premiered || '').slice(0, 4) };
  }
  return null;
}

export default async function handler(req, res) {
  const { t, id } = req.query || {};
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${host}`;
  const valid = ['anime', 'movie', 'tv', 'manga', 'comic'].includes(t) && /^[\w.-]+$/.test(String(id || ''));
  const target = valid ? `${origin}/?t=${encodeURIComponent(t)}&id=${encodeURIComponent(id)}` : origin;

  let item = null;
  try { if (valid) item = await load(t, id); } catch (_) { /* fall back to generic tags */ }

  const title = item ? `${item.title}${item.year ? ` (${item.year})` : ''} — AnimeStream` : 'AnimeStream — Find Your Next Obsession';
  const desc = (item?.desc || 'Watch anime, movies, and series on AnimeStream.').slice(0, 200);
  const image = !item?.image ? '' : item.image.includes('uploads.mangadex.org') ? `${origin}/api/img?u=${encodeURIComponent(item.image)}` : https(item.image);

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="AnimeStream">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(origin + (req.url || ''))}">
${image ? `<meta property="og:image" content="${esc(image)}">
<meta property="og:image:alt" content="${esc(item.title)} poster">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image)}">` : '<meta name="twitter:card" content="summary">'}
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head><body style="background:#090c0a;color:#ece8df;font-family:system-ui,sans-serif">
<p style="padding:24px">Opening AnimeStream… <a style="color:#22c55e" href="${esc(target)}">Continue</a></p></body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(html);
}
