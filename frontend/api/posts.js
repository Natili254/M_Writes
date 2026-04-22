const {
  ensureDatabase,
  fetchPosts,
  createPost,
  clearPosts
} = require('./_supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    await ensureDatabase();
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to initialize database.' });
  }

  if (req.method === 'GET') {
    try {
      const posts = await fetchPosts();
      return res.status(200).json(posts);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to load posts.' });
    }
  }

  if (req.method === 'POST') {
    try {
      const allowedFormats = new Set(['poem', 'article', 'voice']);
      const input = req.body || {};
      const format = allowedFormats.has(String(input.format || '').trim().toLowerCase())
        ? String(input.format).trim().toLowerCase()
        : 'poem';
      const title = String(input.title || '').trim();
      const theme = String(input.theme || '').trim();
      const excerpt = String(input.excerpt || '').trim();
      const body = String(input.body || input.excerpt || '').trim();
      const readTime = String(input.readTime || '2 min read').trim();
      const parsedCreatedAt = input.createdAt ? new Date(input.createdAt) : new Date();

      if (Number.isNaN(parsedCreatedAt.getTime())) {
        return res.status(400).json({ error: 'createdAt must be a valid date' });
      }

      if (!title || !theme || !excerpt || !body) {
        return res.status(400).json({ error: 'title, theme, excerpt, and body are required' });
      }

      const post = await createPost({
        id: input.id,
        format,
        title,
        theme,
        excerpt,
        body,
        readTime,
        createdAt: parsedCreatedAt.toISOString()
      });
      return res.status(201).json(post);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to create post.' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await clearPosts();
      return res.status(204).end();
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to clear posts.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
