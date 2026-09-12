const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { friendlyDbError } = require('../lib/friendlyError');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();
router.use(requireAuth);

/** GET /api/webhook-logs — most recent inbound Nextopper webhook calls, valid or not (debugging aid). */
router.get('/', asyncHandler(async (req, res) => {
  const { data, error } = await req.sb
    .from('webhook_logs')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(100);
  if (error) { console.error('GET /webhook-logs', error); return res.status(400).json({ error: friendlyDbError(error) }); }
  res.json({ logs: data });
}));

module.exports = router;
