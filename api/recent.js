export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const page = parseInt(req.query.page) || 1;
  const perPage = 30;

  try {
    const response = await fetch(
      `https://anikotoapi.site/recent-anime?page=${page}&per_page=${perPage}`
    );
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
