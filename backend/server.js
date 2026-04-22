const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const {
  ensureDatabase,
  fetchPosts,
  createPost,
  clearPosts,
  fetchSubscribers,
  createSubscriber,
  fetchLatestDispatch,
  createMonthlyDispatch
} = require('./supabase-store');

const PORT = Number(process.env.PORT || 3000);
const BACKEND_DIR = __dirname;
const FRONTEND_DIR = path.resolve(BACKEND_DIR, '..', 'frontend');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function sendNoContent(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end();
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(message);
}

function parseRequestBody(req) {
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

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const decodedPath = decodeURIComponent(requested);
  const normalizedPath = path.normalize(decodedPath).replace(/^([/\\])+/, '').replace(/^(\.\.[/\\])+/, '');
  const filePath = path.resolve(FRONTEND_DIR, normalizedPath);

  if (!filePath.startsWith(FRONTEND_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, 'Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

async function handlePosts(req, res) {
  if (req.method === 'OPTIONS') {
    sendNoContent(res);
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
}

async function handleSubscribers(req, res) {
  if (req.method === 'OPTIONS') {
    sendNoContent(res);
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
}

async function handleNewsletterDispatch(req, res) {
  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return;
  }

  if (req.method === 'GET') {
    try {
      const [latestDispatch, subscribers, posts] = await Promise.all([
        fetchLatestDispatch(),
        fetchSubscribers(),
        fetchPosts()
      ]);
      const monthKey = new Date().toISOString().slice(0, 7);
      sendJson(res, 200, {
        sentThisMonth: latestDispatch?.monthKey === monthKey,
        latestDispatch,
        subscriberCount: subscribers.length,
        postCount: posts.length
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Failed to load newsletter dispatch status.' });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const payload = await parseRequestBody(req);
      const mode = payload.mode === 'auto' ? 'auto' : 'manual';
      const result = await createMonthlyDispatch(mode);
      const [latestDispatch, subscribers, posts] = await Promise.all([
        fetchLatestDispatch(),
        fetchSubscribers(),
        fetchPosts()
      ]);
      sendJson(res, 200, {
        ...result,
        latestDispatch,
        subscriberCount: subscribers.length,
        postCount: posts.length
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Failed to create newsletter dispatch.' });
    }
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

const server = http.createServer(async (req, res) => {
  try {
    await ensureDatabase();
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Failed to initialize Supabase.' });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/api/posts') {
    await handlePosts(req, res);
    return;
  }

  if (pathname === '/api/subscribers') {
    await handleSubscribers(req, res);
    return;
  }

  if (pathname === '/api/newsletter/dispatch') {
    await handleNewsletterDispatch(req, res);
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Mutashi Writes server running on http://localhost:${PORT}`);
});
