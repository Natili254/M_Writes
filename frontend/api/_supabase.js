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

module.exports = {
  ensureDatabase,
  fetchPosts,
  createPost,
  clearPosts,
  fetchSubscribers,
  createSubscriber
};
