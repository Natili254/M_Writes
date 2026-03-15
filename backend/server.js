const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const BACKEND_DIR = __dirname;
const FRONTEND_DIR = path.resolve(BACKEND_DIR, '..', 'frontend');
const DATA_DIR = path.join(BACKEND_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'posts.json');
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

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function readPosts() {
  ensureDataStore();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePosts(posts) {
  ensureDataStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(posts, null, 2), 'utf8');
}

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

  if (req.method === 'GET') {
    const posts = readPosts().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    sendJson(res, 200, posts);
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

      const posts = readPosts();
      posts.unshift(normalized);
      writePosts(posts);
      sendJson(res, 201, normalized);
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Invalid request body' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    writePosts([]);
    sendNoContent(res);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

async function ensureSubscribersTable() {
  if (!pgPool) return;
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
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

  serveStatic(req, res, pathname);
});

server.listen(PORT, async () => {
  ensureDataStore();
  if (pgPool) {
    try {
      await ensureSubscribersTable();
      console.log('PostgreSQL subscribers table is ready.');
    } catch (error) {
      console.error('Failed to initialize PostgreSQL subscribers table:', error.message);
    }
  } else {
    console.warn('PostgreSQL not configured. /api/subscribers will return 503.');
  }
  console.log(`Server running at http://localhost:${PORT}`);
});
