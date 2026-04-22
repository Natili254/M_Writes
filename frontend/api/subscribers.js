const {
  ensureDatabase,
  fetchSubscribers,
  createSubscriber
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
      const subscribers = await fetchSubscribers();
      return res.status(200).json({
        count: subscribers.length,
        subscribers
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to load subscribers.' });
    }
  }

  if (req.method === 'POST') {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailPattern.test(email)) {
        return res.status(400).json({ error: 'A valid email is required.' });
      }

      const created = await createSubscriber(email);
      const subscribers = await fetchSubscribers();
      return res.status(201).json({
        created: Boolean(created),
        count: subscribers.length,
        subscribers
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to save subscriber.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
