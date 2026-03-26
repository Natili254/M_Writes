CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  format TEXT NOT NULL DEFAULT 'poem',
  title TEXT NOT NULL,
  theme TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  read_time TEXT NOT NULL DEFAULT '2 min read',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at DESC);

CREATE TABLE IF NOT EXISTS subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscribers_subscribed_at_idx ON subscribers (subscribed_at DESC);
