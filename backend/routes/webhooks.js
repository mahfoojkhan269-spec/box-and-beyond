const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../lib/asyncHandler');
const { serviceClient } = require('../lib/supabase');
const { verifyNextopperSignature, normalizeNextopperPayload } = require('../lib/nextopperWebhook');

const router = express.Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600, // generous — the real backpressure point is the booking queue's own concurrency limit, not this
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/webhooks/nextopper — a student bought a course; ship them the kit.
 *
 * This only ever does fast, local work (verify signature, save the row) and
 * always returns quickly — it deliberately does NOT call DTDC inline. At
 * "lakhs of orders" volume, a burst of incoming webhooks blocking on an
 * external API's latency would slow down or time out Nextopper's own
 * requests. The actual DTDC booking happens asynchronously in
 * jobs/processBookings.js, which picks up every order left at `status:
 * received` on its own schedule (see server.js) — typically within a
 * minute, but decoupled from webhook traffic entirely.
 */
router.post('/nextopper', webhookLimiter, asyncHandler(async (req, res) => {
  const sb = serviceClient();
  const signatureValid = verifyNextopperSignature(req);

  // Log every attempt, valid or not — the only record we have to debug
  // Nextopper's integration once real traffic starts.
  await sb.from('webhook_logs').insert([{
    signature_valid: signatureValid,
    body: req.body,
    error: signatureValid ? null : 'Invalid or missing signature',
  }]);

  if (!signatureValid) return res.sendStatus(401);

  const normalized = normalizeNextopperPayload(req.body);
  if (!normalized.nextopper_order_id) {
    return res.status(400).json({ error: 'Missing order id in payload' });
  }

  // Plain insert, not upsert — Nextopper (or a network retry) may deliver the
  // same order_id more than once, and a naive upsert would reset an
  // already-booked order's status back to 'received', queuing a duplicate
  // DTDC shipment. A unique-violation here means we've already got this
  // order, so it's a no-op, not an error.
  const { data: order, error: insertError } = await sb
    .from('orders')
    .insert([{ ...normalized, status: 'received', received_at: new Date().toISOString() }])
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') return res.sendStatus(200); // duplicate delivery of an order we already have
    console.error('POST /webhooks/nextopper insert', insertError);
    // Ack anyway — this is our bug, not Nextopper's; retrying the same
    // payload won't fix it and we don't want a retry storm.
    return res.sendStatus(200);
  }

  await sb.from('order_events').insert([{ order_id: order.id, status: 'received' }]);

  res.sendStatus(200);
}));

module.exports = router;
