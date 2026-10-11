// Vercel serverless function: /api/manga — a thin MangaDex proxy.
// Browsers can't call api.mangadex.org directly (CORS), so the site talks to this route instead.
//   ?op=list&sort=popular|latest|rating|new&genre=<tagId>&q=<title>&offset=0
//   ?op=tags            ?op=detail&id=<mangaId>
//   ?op=chapters&id=<mangaId>             ?op=pages&id=<chapterId>
const BASE = 'https://api.mangadex.org';
const HEADERS = { 'User-Agent': 'AnimeStream/1.0 (https://www.amstream.site)', Accept: 'application/json' };
const isId = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const SORTS = { trending: 'followedCount', popular: 'followedCount', latest: 'latestUploadedChapter', rating: 'rating', new: 'createdAt' };

async function md(path, params = []) {
  const u = new URL(BASE + path);
  params.forEach(([k, v]) => u.searchParams.append(k, v));
  const r = await fetch(u, { headers: HEADERS });
  if (!r.ok) { const e = new Error('MangaDex ' + r.status); e.status = r.status; throw e; }
  return r.json();
}
const cleanDesc = s => String(s || '').split(/\n\s*---/)[0].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_#>`]/g, '').trim();

function norm(d) {
  const a = d.attributes || {};
  const file = (d.relationships || []).find(r => r.type === 'cover_art')?.attributes?.fileName;
  const base = file ? `https://uploads.mangadex.org/covers/${d.id}/${file}` : '';
  return {
    id: d.id,
    title: a.title?.en || Object.values(a.title || {})[0] || 'Untitled',
    description: cleanDesc(a.description?.en),
    year: a.year || '',
    status: a.status || '',
    tags: (a.tags || []).filter(t => t.attributes?.group === 'genre').map(t => t.attributes?.name?.en).filter(Boolean),
    cover: base ? `${base}.512.jpg` : '',
    cover256: base ? `${base}.256.jpg` : '',
    authors: (d.relationships || []).filter(r => r.type === 'author').map(r => r.attributes?.name).filter(Boolean)
  };
}

export default async function handler(req, res) {
  const q = req.query || {};
  const op = String(q.op || 'list');
  try {
    let body, ttl = 300;
    if (op === 'list') {
      const params = [['limit', '24'], ['offset', String(Math.min(9900, Math.max(0, parseInt(q.offset) || 0)))], ['includes[]', 'cover_art'],
        ['contentRating[]', 'safe'], ['contentRating[]', 'suggestive'], ['availableTranslatedLanguage[]', 'en'], ['hasAvailableChapters', 'true']];
      if (q.q) params.push(['title', String(q.q).slice(0, 100)]); // search keeps MangaDex's relevance order
      else params.push([`order[${SORTS[q.sort] || SORTS.popular}]`, 'desc']);
      if (q.sort === 'trending') params.push(['updatedAtSince', new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19)]); // most-followed among titles updated this week
      if (q.genre && isId(q.genre)) params.push(['includedTags[]', q.genre]);
      const j = await md('/manga', params);
      body = { items: (j.data || []).map(norm), total: j.total || 0 };
      ttl = 600;
    } else if (op === 'tags') {
      const j = await md('/manga/tag');
      body = { tags: (j.data || []).filter(t => t.attributes?.group === 'genre').map(t => ({ id: t.id, name: t.attributes?.name?.en })).filter(t => t.name) };
      ttl = 86400;
    } else if (op === 'detail') {
      if (!isId(q.id)) return res.status(400).json({ error: 'bad id' });
      const j = await md(`/manga/${q.id}`, [['includes[]', 'cover_art'], ['includes[]', 'author']]);
      body = { item: norm(j.data) };
      ttl = 3600;
    } else if (op === 'chapters') {
      if (!isId(q.id)) return res.status(400).json({ error: 'bad id' });
      const out = [], seen = new Set();
      let offset = 0, total = Infinity;
      for (let page = 0; page < 4 && offset < total; page++) {
        const j = await md(`/manga/${q.id}/feed`, [['limit', '500'], ['offset', String(offset)], ['translatedLanguage[]', 'en'], ['includeExternalUrl', '0'],
          ['order[volume]', 'asc'], ['order[chapter]', 'asc'], ['includes[]', 'scanlation_group'], ['contentRating[]', 'safe'], ['contentRating[]', 'suggestive']]);
        total = j.total || 0; offset += 500;
        for (const c of j.data || []) {
          const a = c.attributes || {};
          if (!a.pages || a.externalUrl) continue;
          const key = a.chapter != null ? String(a.chapter) : c.id; // one copy per chapter number
          if (seen.has(key)) continue;
          seen.add(key);
          const group = (c.relationships || []).filter(r => r.type === 'scanlation_group').map(r => r.attributes?.name).filter(Boolean).join(', ');
          out.push({ id: c.id, chapter: a.chapter ?? null, volume: a.volume ?? null, title: a.title || '', pages: a.pages, group });
        }
      }
      out.sort((x, y) => (parseFloat(x.chapter) || 0) - (parseFloat(y.chapter) || 0));
      body = { chapters: out };
      ttl = 600;
    } else if (op === 'pages') {
      if (!isId(q.id)) return res.status(400).json({ error: 'bad id' });
      const j = await md(`/at-home/server/${q.id}`);
      const base = j.baseUrl, hash = j.chapter?.hash;
      body = {
        pages: (j.chapter?.data || []).map(f => `${base}/data/${hash}/${f}`),
        saver: (j.chapter?.dataSaver || []).map(f => `${base}/data-saver/${hash}/${f}`)
      };
      ttl = 0; // page URLs are time-limited, never cache them
    } else {
      return res.status(400).json({ error: 'unknown op' });
    }
    res.setHeader('Cache-Control', ttl ? `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}` : 'no-store');
    res.status(200).json(body);
  } catch (e) {
    res.status(e.status === 404 ? 404 : 502).json({ error: String(e.message || e) });
  }
}
