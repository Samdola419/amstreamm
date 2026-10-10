// Vercel serverless function: /api/cover
// Link-preview image for the main site: a trending anime poster (rotates daily) instead of the logo.
export default async function handler(req, res) {
  try {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: 'query{Page(page:1,perPage:8){media(type:ANIME,sort:TRENDING_DESC,isAdult:false){coverImage{extraLarge large}}}}' })
    });
    const list = ((await r.json())?.data?.Page?.media || []).filter(m => m.coverImage?.extraLarge || m.coverImage?.large);
    if (!list.length) throw new Error('no trending titles');
    const day = Math.floor(Date.now() / 86400000);
    const pick = list[day % list.length].coverImage;
    const img = await fetch(pick.extraLarge || pick.large);
    if (!img.ok) throw new Error('poster fetch failed');
    res.setHeader('Content-Type', img.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    res.status(200).send(Buffer.from(await img.arrayBuffer()));
  } catch (_) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    res.redirect(302, '/logo.jpg'); // never leave the preview empty
  }
}
