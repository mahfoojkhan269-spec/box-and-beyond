const { anonClient, clientForToken } = require('../lib/supabase');

/**
 * Verifies the bearer token against Supabase, then attaches:
 *   req.user  — the authenticated Supabase user (one of the 2-3 ops staff)
 *   req.token — the raw access token
 *   req.sb    — a Supabase client scoped to that token (RLS applies as this user)
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired session' });

  req.user = data.user;
  req.token = token;
  req.sb = clientForToken(token);
  next();
}

module.exports = { requireAuth };
