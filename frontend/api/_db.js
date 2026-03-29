const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { Pool } = require('pg');

const hasPostgresConfig = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
const FILE_STORE_PATH = process.env.VERCEL
  ? path.join('/tmp', 'mutashiii-content.json')
  : path.resolve(__dirname, '..', '..', 'backend', 'data', 'content.json');

let pool;

function getPool() {
  if (!hasPostgresConfig) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || undefined,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
    });
  }
  return pool;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(payload));
}

function sendNoContent(res) {
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end();
}

function parseRequestBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);

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
  const parsedCreatedAt = input.createdAt ? new Date(input.createdAt) : new Date();

  if (Number.isNaN(parsedCreatedAt.getTime())) {
    return { error: 'createdAt must be a valid date' };
  }

  const createdAt = parsedCreatedAt.toISOString();

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

async function ensureFileStore() {
  await fs.mkdir(path.dirname(FILE_STORE_PATH), { recursive: true });
  try {
    await fs.access(FILE_STORE_PATH);
  } catch {
    await fs.writeFile(FILE_STORE_PATH, JSON.stringify({ posts: [], subscribers: [] }, null, 2));
  }
}

async function readFileStore() {
  await ensureFileStore();
  const raw = await fs.readFile(FILE_STORE_PATH, 'utf8');

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

  await fs.writeFile(FILE_STORE_PATH, JSON.stringify(payload, null, 2));
}

async function ensureDatabase() {
  const pgPool = getPool();
  if (!pgPool) {
    await ensureFileStore();
    return;
  }

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
  if (!hasPostgresConfig) {
    const store = await readFileStore();
    return [...store.posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  const { rows } = await getPool().query(`
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
  if (!hasPostgresConfig) {
    const store = await readFileStore();
    store.posts.unshift(post);
    await writeFileStore(store);
    return post;
  }

  const { rows } = await getPool().query(`
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
  if (!hasPostgresConfig) {
    const store = await readFileStore();
    store.posts = [];
    await writeFileStore(store);
    return;
  }

  await getPool().query('DELETE FROM posts');
}

async function fetchSubscribers() {
  if (!hasPostgresConfig) {
    const store = await readFileStore();
    return [...store.subscribers].sort((a, b) => new Date(b.subscribedAt) - new Date(a.subscribedAt));
  }

  const { rows } = await getPool().query(`
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
  if (!hasPostgresConfig) {
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

  const { rows } = await getPool().query(`
    INSERT INTO subscribers (id, email)
    VALUES ($1, $2)
    ON CONFLICT (email) DO NOTHING
    RETURNING email, subscribed_at
  `, [id, email]);

  return rows[0] || null;
}

module.exports = {
  getPool,
  hasPostgresConfig,
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
