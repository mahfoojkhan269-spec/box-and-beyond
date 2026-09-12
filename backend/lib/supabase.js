const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY missing — check backend/.env');
}

/** Unauthenticated client — only used for signInWithPassword during login. */
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Per-request client scoped to the caller's access token, so every query
 * still runs under Postgres RLS as that staff user.
 */
function clientForToken(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Service-role client — bypasses RLS entirely. Used for the Nextopper webhook,
 * which has no logged-in user/JWT to scope a request to, and for the DTDC
 * status-sync cron job which runs outside any request. Never expose this to
 * anything reachable from the frontend.
 */
function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

module.exports = { anonClient, clientForToken, serviceClient };
