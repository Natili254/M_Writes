CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  format TEXT NOT NULL DEFAULT 'poem',
  title TEXT NOT NULL,
  theme TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS newsletter_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_key TEXT UNIQUE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mode TEXT NOT NULL DEFAULT 'manual',
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  post_id UUID NOT NULL,
  post_title TEXT NOT NULL,
  post_theme TEXT NOT NULL,
  post_format TEXT NOT NULL DEFAULT 'poem',
  excerpt TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS newsletter_dispatches_sent_at_idx ON newsletter_dispatches (sent_at DESC);
