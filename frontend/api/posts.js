const {
  sendJson,
  sendNoContent,
  parseRequestBody,
  normalizePost,
  ensureDatabase,
  fetchPosts,
  createPost,
  clearPosts
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
      const posts = await fetchPosts();
      sendJson(res, 200, posts);
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Failed to load posts.' });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const payload = await parseRequestBody(req);
      const normalized = normalizePost(payload);
      if (normalized.error) {
        sendJson(res, 400, { error: normalized.error });
        return;
      }

      const post = await createPost(normalized);
      if (!post) {
        sendJson(res, 500, { error: 'Failed to create post.' });
        return;
      }
      sendJson(res, 201, post);
    } catch (error) {
      const statusCode = error.message === 'Invalid JSON body' || error.message === 'Payload too large'
        ? 400
        : 500;
      sendJson(res, statusCode, { error: error.message || 'Failed to create post.' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      await clearPosts();
      sendNoContent(res);
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Failed to clear posts.' });
    }
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
};
