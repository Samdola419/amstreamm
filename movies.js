export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const page = parseInt(req.query.page) || 1;

  try {
    const response = await fetch(`https://vid-src.top/movie/${page}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'AnimeStream/1.0' }
    });
    if (!response.ok) throw new Error('Upstream ' + response.status);
    const data = await response.json();
    if (Array.isArray(data.result)) {
      data.result = data.result.map((m) => {
        const imdb = m.imdb_id || '';
        const tmdb = m.tmdb_id || '';
        return {
          ...m,
          imdb_id: imdb,
          tmdb_id: tmdb,
          poster: imdb ? `https://images.metahub.space/poster/medium/${imdb}/img` : '',
          backdrop: imdb ? `https://images.metahub.space/background/medium/${imdb}/img` : '',
          embed_url: (m.embed_url || '').replace(/^http:\/\//, 'https://'),
          embed_url_tmdb: (m.embed_url_tmdb || '').replace(/^http:\/\//, 'https://')
        };
      });
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message, result: [], pages: 0 });
  }
}
