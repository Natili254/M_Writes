const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const BACKEND_DIR = __dirname;
const FRONTEND_DIR = path.resolve(BACKEND_DIR, '..', 'frontend');
const FILE_STORE_PATH = path.join(BACKEND_DIR, 'data', 'content.json');
const hasPostgresConfig = Boolean(process.env.DATABASE_URL || process.env.PGHOST);

let pgPool = null;
if (hasPostgresConfig) {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
  });
  
  // Add error listener to pool
  pgPool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err);
  });
}

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

async function ensureFileStore() {
  await fsp.mkdir(path.dirname(FILE_STORE_PATH), { recursive: true });
  try {
    await fsp.access(FILE_STORE_PATH);
  } catch {
    await fsp.writeFile(FILE_STORE_PATH, JSON.stringify({ posts: [], subscribers: [] }, null, 2));
  }
}

async function readFileStore() {
  await ensureFileStore();
  const raw = await fsp.readFile(FILE_STORE_PATH, 'utf8');

  try {
    const parsed = JSON.parse(raw);
    return {
      posts: Array.isArray(parsed.posts) ? parsed.posts : [],
      subscribers: Array.isArray(parsed.subscribers) ? parsed.subscribers : []
    };
  } catch {
    return { posts: [], subscribers: [] };
  }
}

async function writeFileStore(data) {
  await ensureFileStore();
  const payload = {
    posts: Array.isArray(data.posts) ? data.posts : [],
    subscribers: Array.isArray(data.subscribers) ? data.subscribers : []
  };

  await fsp.writeFile(FILE_STORE_PATH, JSON.stringify(payload, null, 2));
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
    try {
      const posts = await fetchPosts();
      sendJson(res, 200, posts);
    } catch (error) {
      console.error('GET /api/posts error:', error);
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
      console.error('POST /api/posts error:', error);
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
      console.error('DELETE /api/posts error:', error);
      sendJson(res, 500, { error: error.message || 'Failed to clear posts.' });
    }
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

async function ensureDatabase() {
  if (!pgPool) {
    console.log('Using file-based storage');
    await ensureFileStore();
    return;
  }

  try {
    // Test the connection
    const result = await pgPool.query('SELECT NOW()');
    console.log('✓ PostgreSQL connection successful');

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id UUID PRIMARY KEY,
        format TEXT NOT NULL DEFAULT 'poem',
        title TEXT NOT NULL,
        theme TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        read_time TEXT NOT NULL DEFAULT '2 min read',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pgPool.query(`
      ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT ''
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

    console.log('✓ PostgreSQL tables are ready');
  } catch (error) {
    console.error('✗ PostgreSQL connection failed:', error.message);
    console.error('Falling back to file-based storage');
    pgPool = null;
    await ensureFileStore();
  }
}

async function fetchPosts() {
  if (!pgPool) {
    const store = await readFileStore();
    return [...store.posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  const { rows } = await pgPool.query(`
    SELECT id, format, title, theme, excerpt, body, read_time, created_at
    FROM posts
    ORDER BY created_at DESC
  `);
  return rows.map((row) => ({
    id: row.id,
    format: row.format || 'poem',
    title: row.title,
    theme: row.theme,
    excerpt: row.excerpt,
    body: row.body || row.excerpt,
    readTime: row.read_time,
    createdAt: row.created_at
  }));
}

async function createPost(post) {
  if (!pgPool) {
    const store = await readFileStore();
    store.posts.unshift(post);
    await writeFileStore(store);
    return post;
  }

  const { rows } = await pgPool.query(`
    INSERT INTO posts (id, format, title, theme, excerpt, body, read_time, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, format, title, theme, excerpt, body, read_time, created_at
  `, [post.id, post.format, post.title, post.theme, post.excerpt, post.body, post.readTime, post.createdAt]);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    format: row.format || 'poem',
    title: row.title,
    theme: row.theme,
    excerpt: row.excerpt,
    body: row.body || row.excerpt,
    readTime: row.read_time,
    createdAt: row.created_at
  };
}

async function clearPosts() {
  if (!pgPool) {
    const store = await readFileStore();
    store.posts = [];
    await writeFileStore(store);
    return;
  }

  await pgPool.query('DELETE FROM posts');
}

async function fetchSubscribers() {
  if (!pgPool) {
    const store = await readFileStore();
    return [...store.subscribers].sort((a, b) => new Date(b.subscribedAt) - new Date(a.subscribedAt));
  }

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
  if (!pgPool) {
    const store = await readFileStore();
    const existing = store.subscribers.find((subscriber) => subscriber.email === email);
    if (existing) return null;

    const subscriber = {
      email,
      subscribedAt: new Date().toISOString()
    };

    store.subscribers.unshift(subscriber);
    await writeFileStore(store);
    return subscriber;
  }

  const id = typeof randomUUID === 'function'
    ? randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    const { rows } = await pgPool.query(`
      INSERT INTO subscribers (id, email)
      VALUES ($1, $2)
      ON CONFLICT (email) DO NOTHING
      RETURNING email, subscribed_at
    `, [id, email]);

    return rows[0] || null;
  } catch (error) {
    console.error('Database error in createSubscriber:', error);
    throw error;
  }
}

async function handleSubscribersApi(req, res) {
  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request to /api/subscribers');
    sendNoContent(res);
    return;
  }

  if (req.method === 'GET') {
    console.log('GET /api/subscribers');
    try {
      const subscribers = await fetchSubscribers();
      sendJson(res, 200, {
        count: subscribers.length,
        subscribers
      });
    } catch (error) {
      console.error('GET /api/subscribers error:', error);
      sendJson(res, 500, { error: error.message || 'Failed to load subscribers.' });
    }
    return;
  }

  if (req.method === 'POST') {
    console.log('POST /api/subscribers');
    try {
      const payload = await parseRequestBody(req);
      console.log('Request payload:', payload);
      
      const email = normalizeEmail(payload.email);
      if (!email) {
        console.log('Invalid email provided:', payload.email);
        sendJson(res, 400, { error: 'A valid email is required.' });
        return;
      }

      console.log('Creating subscriber for:', email);
      const created = await createSubscriber(email);
      const subscribers = await fetchSubscribers();
      
      console.log('Subscriber created:', created !== null, 'Total subscribers:', subscribers.length);
      sendJson(res, 201, {
        created: Boolean(created),
        count: subscribers.length,
        subscribers
      });
    } catch (error) {
      console.error('POST /api/subscribers error:', error);
      sendJson(res, 500, { error: error.message || 'Failed to save subscriber.' });
    }
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  console.log(`${req.method} ${pathname}`);

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
  try {
    await ensureDatabase();
  } catch (error) {
    console.error('✗ Failed to initialize storage:', error.message);
  }
  console.log(`\n🚀 Server running at http://localhost:${PORT}\n`);
});
