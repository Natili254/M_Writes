const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');

let supabaseAdmin;

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return supabaseAdmin;
}

async function ensureDatabase() {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('posts').select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message || 'Supabase connection failed.');
}

function mapPost(row) {
  return {
    id: row.id,
    format: row.format || 'poem',
    title: row.title,
    theme: row.theme,
    excerpt: row.excerpt,
    body: row.body || row.excerpt || '',
    readTime: row.read_time || '2 min read',
    createdAt: row.created_at
  };
}

function mapSubscriber(row) {
  return {
    email: row.email,
    subscribedAt: row.subscribed_at
  };
}

function mapDispatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    monthKey: row.month_key,
    sentAt: row.sent_at,
    mode: row.mode,
    subscriberCount: row.subscriber_count,
    postId: row.post_id,
    postTitle: row.post_title,
    postTheme: row.post_theme,
    postFormat: row.post_format,
    excerpt: row.excerpt,
    subject: row.subject
  };
}

async function fetchPosts() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('posts')
    .select('id, format, title, theme, excerpt, body, read_time, created_at')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message || 'Failed to load posts.');
  return (data || []).map(mapPost);
}

async function createPost(post) {
  const supabase = getSupabaseAdmin();
  const payload = {
    id: post.id || randomUUID(),
    format: post.format || 'poem',
    title: post.title,
    theme: post.theme,
    excerpt: post.excerpt,
    body: post.body || post.excerpt || '',
    read_time: post.readTime || '2 min read',
    created_at: post.createdAt || new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('posts')
    .insert(payload)
    .select('id, format, title, theme, excerpt, body, read_time, created_at')
    .single();

  if (error) throw new Error(error.message || 'Failed to create post.');
  return mapPost(data);
}

async function clearPosts() {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('posts')
    .delete()
    .not('id', 'is', null);

  if (error) throw new Error(error.message || 'Failed to clear posts.');
}

async function fetchSubscribers() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('subscribers')
    .select('email, subscribed_at')
    .order('subscribed_at', { ascending: false });

  if (error) throw new Error(error.message || 'Failed to load subscribers.');
  return (data || []).map(mapSubscriber);
}

async function createSubscriber(email) {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: existingError } = await supabase
    .from('subscribers')
    .select('email, subscribed_at')
    .eq('email', email)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message || 'Failed to check subscriber.');
  if (existing) return null;

  const payload = {
    id: randomUUID(),
    email
  };

  const { data, error } = await supabase
    .from('subscribers')
    .insert(payload)
    .select('email, subscribed_at')
    .single();

  if (error) throw new Error(error.message || 'Failed to save subscriber.');
  return mapSubscriber(data);
}

function toMonthKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function buildDispatchSnapshot(post, subscriberCount, mode) {
  const sentAt = new Date().toISOString();
  return {
    id: randomUUID(),
    month_key: toMonthKey(new Date(sentAt)),
    sent_at: sentAt,
    mode,
    subscriber_count: subscriberCount,
    post_id: post.id,
    post_title: post.title,
    post_theme: post.theme,
    post_format: post.format || 'poem',
    excerpt: post.excerpt || '',
    subject: `Monthly poem: ${post.title}`
  };
}

async function fetchLatestDispatch() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('newsletter_dispatches')
    .select('id, month_key, sent_at, mode, subscriber_count, post_id, post_title, post_theme, post_format, excerpt, subject')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message || 'Failed to load dispatch status.');
  return mapDispatch(data);
}

async function createMonthlyDispatch(mode = 'manual') {
  const monthKey = toMonthKey();
  const subscribers = await fetchSubscribers();
  const posts = await fetchPosts();
  const featuredPost = posts.find((post) => post.format === 'poem') || posts[0];

  if (!subscribers.length) {
    return { created: false, reason: 'no-subscribers', dispatch: null };
  }
  if (!featuredPost) {
    return { created: false, reason: 'no-posts', dispatch: null };
  }

  const supabase = getSupabaseAdmin();
  const { data: existing, error: existingError } = await supabase
    .from('newsletter_dispatches')
    .select('id, month_key, sent_at, mode, subscriber_count, post_id, post_title, post_theme, post_format, excerpt, subject')
    .eq('month_key', monthKey)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message || 'Failed to check monthly dispatch.');
  if (existing) {
    return { created: false, reason: 'already-sent', dispatch: mapDispatch(existing) };
  }

  const payload = buildDispatchSnapshot(featuredPost, subscribers.length, mode);
  const { data, error } = await supabase
    .from('newsletter_dispatches')
    .insert(payload)
    .select('id, month_key, sent_at, mode, subscriber_count, post_id, post_title, post_theme, post_format, excerpt, subject')
    .single();

  if (error) throw new Error(error.message || 'Failed to create newsletter dispatch.');
  return { created: true, reason: 'sent', dispatch: mapDispatch(data) };
}

module.exports = {
  ensureDatabase,
  fetchPosts,
  createPost,
  clearPosts,
  fetchSubscribers,
  createSubscriber,
  fetchLatestDispatch,
  createMonthlyDispatch
};
