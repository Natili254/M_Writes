const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const BACKEND_DIR = __dirname;
const FRONTEND_DIR = path.resolve(BACKEND_DIR, '..', 'frontend');
const hasPostgresConfig = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
const pgPool = hasPostgresConfig ? new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
}) : null;

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
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
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
  const readTime = String(input.readTime || '2 min read').trim();
  const createdAt = input.createdAt ? new Date(input.createdAt).toISOString() : new Date().toISOString();

  if (!title || !theme || !excerpt) {
    return { error: 'title, theme, and excerpt are required' };
  }

  return {
    id: input.id || (typeof randomUUID === 'function' ? randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    format,
    title,
    theme,
    excerpt,
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

async function handleApi(req, res) {
  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return;
  }

  if (!pgPool) {
    sendJson(res, 503, { error: 'PostgreSQL is not configured on the server.' });
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
}

async function ensureDatabase() {
  if (!pgPool) return;
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id UUID PRIMARY KEY,
      format TEXT NOT NULL DEFAULT 'poem',
      title TEXT NOT NULL,
      theme TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      read_time TEXT NOT NULL DEFAULT '2 min read',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`
    ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'poem'
  `);
  await pgPool.query(`
    CREATE INDEX IF NOT EXISTS posts_created_at_idx
    ON posts (created_at DESC)
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`
    CREATE INDEX IF NOT EXISTS subscribers_subscribed_at_idx
    ON subscribers (subscribed_at DESC)
  `);
}

async function fetchPosts() {
  const { rows } = await pgPool.query(`
    SELECT id, format, title, theme, excerpt, read_time, created_at
    FROM posts
    ORDER BY created_at DESC
  `);
  return rows.map((row) => ({
    id: row.id,
    format: row.format || 'poem',
    title: row.title,
    theme: row.theme,
    excerpt: row.excerpt,
    readTime: row.read_time,
    createdAt: row.created_at
  }));
}

async function createPost(post) {
  const { rows } = await pgPool.query(`
    INSERT INTO posts (id, format, title, theme, excerpt, read_time, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, format, title, theme, excerpt, read_time, created_at
  `, [post.id, post.format, post.title, post.theme, post.excerpt, post.readTime, post.createdAt]);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    format: row.format || 'poem',
    title: row.title,
    theme: row.theme,
    excerpt: row.excerpt,
    readTime: row.read_time,
    createdAt: row.created_at
  };
}

async function clearPosts() {
  await pgPool.query('DELETE FROM posts');
}

async function fetchSubscribers() {
  const { rows } = await pgPool.query(`
    SELECT email, subscribed_at
    FROM subscribers
    ORDER BY subscribed_at DESC
  `);
  return rows.map((row) => ({
    email: row.email,
    subscribedAt: row.subscribed_at
  }));
}

async function createSubscriber(email) {
  const id = typeof randomUUID === 'function'
    ? randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const { rows } = await pgPool.query(`
    INSERT INTO subscribers (id, email)
    VALUES ($1, $2)
    ON CONFLICT (email) DO NOTHING
    RETURNING email, subscribed_at
  `, [id, email]);

  return rows[0] || null;
}

async function handleSubscribersApi(req, res) {
  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return;
  }

  if (!pgPool) {
    sendJson(res, 503, { error: 'PostgreSQL is not configured on the server.' });
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/api/posts') {
    await handleApi(req, res);
    return;
  }

  if (pathname === '/api/subscribers') {
    await handleSubscribersApi(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }
- 8 
  serveStatic(req, res, pathname);
});

server.listen(PORT, async () => {
  if (pgPool) {
    try {
      await ensureDatabase();
      console.log('PostgreSQL tables are ready.');
    } catch (error) {
      console.error('Failed to initialize PostgreSQL tables:', error.message);
    }
  } else {
    console.warn('PostgreSQL not configured. API routes will return 503.');
  }
  console.log(`Server running at http://localhost:${PORT}`);
});
