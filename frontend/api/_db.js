const { randomUUID } = require('crypto');
const {
  ensureDatabase,
  fetchPosts,
  createPost,
  clearPosts,
  fetchSubscribers,
  createSubscriber
} = require('./_supabase');

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendNoContent(res) {
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.end();
}

function parseRequestBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try {
      return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    } catch {
      return Promise.reject(new Error('Invalid JSON body'));
    }
  }
  if (Buffer.isBuffer(req.body)) {
    try {
      const text = req.body.toString('utf8');
      return Promise.resolve(text ? JSON.parse(text) : {});
    } catch {
      return Promise.reject(new Error('Invalid JSON body'));
    }
  }

  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeEmail(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) return null;
  return email;
}

function normalizePost(input) {
  const allowedFormats = new Set(['poem', 'article', 'voice']);
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
    return { error: 'createdAt must be a valid date' };
  }

  const createdAt = parsedCreatedAt.toISOString();

  if (!title || !theme || !excerpt || !body) {
    return { error: 'title, theme, excerpt, and body are required' };
  }

  return {
    id: input.id || (typeof randomUUID === 'function' ? randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    format,
    title,
    theme,
    excerpt,
    body,
    readTime,
    createdAt
  };
}

module.exports = {
  sendJson,
  sendNoContent,
  parseRequestBody,
  normalizeEmail,
  normalizePost,
  ensureDatabase,
  fetchPosts,
  createPost,
  clearPosts,
  fetchSubscribers,
  createSubscriber
};
