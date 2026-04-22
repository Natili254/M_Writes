const {
  ensureDatabase,
  fetchPosts,
  fetchSubscribers,
  fetchLatestDispatch,
  createMonthlyDispatch
} = require('../_supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
      const [latestDispatch, subscribers, posts] = await Promise.all([
        fetchLatestDispatch(),
        fetchSubscribers(),
        fetchPosts()
      ]);
      const monthKey = new Date().toISOString().slice(0, 7);
      return res.status(200).json({
        sentThisMonth: latestDispatch?.monthKey === monthKey,
        latestDispatch,
        subscriberCount: subscribers.length,
        postCount: posts.length
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to load newsletter dispatch status.' });
    }
  }

  if (req.method === 'POST') {
    try {
      const mode = req.body?.mode === 'auto' ? 'auto' : 'manual';
      const result = await createMonthlyDispatch(mode);
      const [latestDispatch, subscribers, posts] = await Promise.all([
        fetchLatestDispatch(),
        fetchSubscribers(),
        fetchPosts()
      ]);
      return res.status(200).json({
        ...result,
        latestDispatch,
        subscriberCount: subscribers.length,
        postCount: posts.length
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to create newsletter dispatch.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
