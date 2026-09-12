const express = require('express');
const rateLimit = require('express-rate-limit');
const { anonClient } = require('../lib/supabase');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

// Only 2-3 pre-created staff accounts log in here — no public signup, but
// still guard against brute-force attempts against those few accounts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
});

function sessionPayload(data) {
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: { id: data.user.id, email: data.user.email },
  };
}

/** POST /api/auth/login — staff accounts are created directly in the Supabase dashboard, not here. */
router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: 'Invalid email or password' });

  res.json(sessionPayload(data));
}));

/** POST /api/auth/refresh — so a page reload doesn't log staff out. */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refresh_token } = req.body || {};
  if (!refresh_token) return res.status(400).json({ error: 'Missing refresh_token' });

  const { data, error } = await anonClient.auth.refreshSession({ refresh_token });
  if (error || !data.session) return res.status(401).json({ error: 'Session expired, please log in again' });

  res.json(sessionPayload(data));
}));

module.exports = router;
