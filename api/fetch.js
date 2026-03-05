export default async function handler(req, res) {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch page: ' + response.status });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return res.status(400).json({ error: 'URL did not return HTML (got ' + contentType + ')' });
    }

    const html = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ html: html });
  } catch (err) {
    return res.status(502).json({ error: 'Fetch failed: ' + err.message });
  }
}
