// Vercel serverless function: /api/cover
// Link-preview image for the main site: a random poster from the top 8 trending anime and top 8 popular movies.
async function animePosters() {
  const r = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: 'query{Page(page:1,perPage:8){media(type:ANIME,sort:TRENDING_DESC,isAdult:false){coverImage{extraLarge large}}}}' })
  });
  const list = (await r.json())?.data?.Page?.media || [];
  return list.map(m => m.coverImage?.extraLarge || m.coverImage?.large).filter(Boolean);
}
async function moviePosters() {
  const r = await fetch('https://v3-cinemeta.strem.io/catalog/movie/top.json');
  const metas = (await r.json())?.metas || [];
  return metas.slice(0, 8).map(m => m.poster || (m.imdb_id ? `https://images.metahub.space/poster/large/${m.imdb_id}/img` : '')).filter(Boolean);
}

export default async function handler(req, res) {
  try {
    // Either source can fail without breaking the preview.
    const [anime, movies] = await Promise.all([animePosters().catch(() => []), moviePosters().catch(() => [])]);
    const pool = [...anime, ...movies].map(u => u.replace(/^http:\/\//i, 'https://'));
    if (!pool.length) throw new Error('no posters available');
    // Try a random pick first, then the rest, so one dead poster link never leaves the preview empty.
    const start = Math.floor(Math.random() * pool.length);
    for (let i = 0; i < pool.length; i++) {
      const img = await fetch(pool[(start + i) % pool.length]).catch(() => null);
      if (!img || !img.ok) continue;
      res.setHeader('Content-Type', img.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).send(Buffer.from(await img.arrayBuffer()));
    }
    throw new Error('no poster could be loaded');
  } catch (_) {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    res.redirect(302, '/logo.jpg');
  }
}
