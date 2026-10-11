// Vercel serverless function: /api/comics — Internet Archive comics that are free to read.
//   ?op=list&sort=trending|popular|latest|classic&genre=Horror&q=batman&offset=0
//   ?op=detail&id=<archive identifier>
// Only items that are not borrow-only / print-disabled are listed, so every result opens in the reader.
const IA = 'https://archive.org';
const HEADERS = { 'User-Agent': 'AnimeStream/1.0 (https://www.amstream.site)', Accept: 'application/json' };
const isId = s => /^[A-Za-z0-9._-]{1,120}$/.test(String(s || ''));
const clean = s => String(s || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const first = v => Array.isArray(v) ? v[0] : v;
const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const SORTS = { trending: 'week desc', popular: 'downloads desc', latest: 'addeddate desc', classic: 'date asc' };
const BASE_Q = 'mediatype:texts AND (subject:"comic books" OR subject:comics OR subject:"graphic novels" OR collection:comics) ' +
  'AND -access-restricted-item:true AND -collection:inlibrary AND -collection:printdisabled AND -subject:"adult"';

function norm(d) {
  const id = first(d.identifier);
  return {
    id,
    title: strip(first(d.title)) || id,
    description: strip(first(d.description)).slice(0, 600),
    year: String(first(d.year) || first(d.date) || '').slice(0, 4),
    authors: arr(d.creator).map(strip).slice(0, 3),
    tags: arr(d.subject).map(strip).filter(Boolean).slice(0, 6),
    cover: `${IA}/services/img/${id}`,
    pages: Number(first(d.imagecount)) || 0
  };
}

async function search(query, sort, offset) {
  const u = new URL(IA + '/advancedsearch.php');
  u.searchParams.set('q', query);
  ['identifier', 'title', 'creator', 'year', 'description', 'subject', 'imagecount'].forEach(f => u.searchParams.append('fl[]', f));
  u.searchParams.append('sort[]', sort);
  u.searchParams.set('rows', '24');
  u.searchParams.set('page', String(Math.floor(offset / 24) + 1));
  u.searchParams.set('output', 'json');
  const r = await fetch(u, { headers: HEADERS });
  if (!r.ok) throw new Error('Archive ' + r.status);
  const j = await r.json();
  if (!j.response) throw new Error('Archive returned no results block');
  return j.response;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const op = String(q.op || 'list');
  try {
    let body, ttl = 600;
    if (op === 'list') {
      let query = BASE_Q;
      const text = clean(q.q), genre = clean(q.genre);
      if (text) query += ` AND (title:(${text}) OR creator:(${text}) OR subject:(${text}))`;
      if (genre) query += ` AND (subject:"${genre}" OR title:(${genre}))`;
      const offset = Math.min(9000, Math.max(0, parseInt(q.offset) || 0));
      const sort = SORTS[q.sort] || SORTS.popular;
      let resp;
      try { resp = await search(query, sort, offset); }
      catch (e) { resp = await search(query, SORTS.popular, offset); } // an unsupported sort never leaves a shelf empty
      body = { items: (resp.docs || []).map(norm), total: resp.numFound || 0 };
    } else if (op === 'detail') {
      if (!isId(q.id)) return res.status(400).json({ error: 'bad id' });
      const r = await fetch(`${IA}/metadata/${encodeURIComponent(q.id)}`, { headers: HEADERS });
      if (!r.ok) throw Object.assign(new Error('Archive ' + r.status), { status: r.status });
      const m = (await r.json())?.metadata;
      if (!m) return res.status(404).json({ error: 'not found' });
      body = { item: norm({ ...m, identifier: q.id }) };
      ttl = 3600;
    } else {
      return res.status(400).json({ error: 'unknown op' });
    }
    res.setHeader('Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`);
    res.status(200).json(body);
  } catch (e) {
    res.status(e.status === 404 ? 404 : 502).json({ error: String(e.message || e) });
  }
}
