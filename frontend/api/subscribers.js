const {
  sendJson,
  sendNoContent,
  parseRequestBody,
  normalizeEmail,
  ensureDatabase,
  fetchSubscribers,
  createSubscriber
} = require('./_db');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return;
  }

  try {
    await ensureDatabase();
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Failed to initialize database.' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const subscribers = await fetchSubscribers();
      sendJson(res, 200, {
        count: subscribers.length,
        subscribers
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Failed to load subscribers.' });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const payload = await parseRequestBody(req);
      const email = normalizeEmail(payload.email);
      if (!email) {
        sendJson(res, 400, { error: 'A valid email is required.' });
        return;
      }

      const created = await createSubscriber(email);
      const subscribers = await fetchSubscribers();
      sendJson(res, 201, {
        created: Boolean(created),
        count: subscribers.length,
        subscribers
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Failed to save subscriber.' });
    }
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
};
