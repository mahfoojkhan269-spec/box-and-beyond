const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../lib/asyncHandler');
const { serviceClient } = require('../lib/supabase');
const { verifyNextopperSignature, normalizeNextopperPayload } = require('../lib/nextopperWebhook');
const { createDtdcShipment } = require('../lib/dtdc');

const router = express.Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/** POST /api/webhooks/nextopper — a student bought a course; ship them the kit. */
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

  const { data: order, error: upsertError } = await sb
    .from('orders')
    .upsert(
      { ...normalized, status: 'received', received_at: new Date().toISOString() },
      { onConflict: 'nextopper_order_id', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (upsertError) {
    console.error('POST /webhooks/nextopper upsert', upsertError);
    // Ack anyway — this is our bug, not Nextopper's; retrying the same
    // payload won't fix it and we don't want a retry storm.
    return res.sendStatus(200);
  }

  try {
    const shipment = await createDtdcShipment(order);
    await sb.from('shipments').insert([{
      order_id: order.id,
      dtdc_awb_number: shipment.awb,
      dtdc_reference: shipment.referenceNumber,
      label_url: shipment.labelUrl,
      courier_status: 'booked',
      last_synced_at: new Date().toISOString(),
    }]);
    await sb.from('orders').update({ status: 'shipment_created' }).eq('id', order.id);
  } catch (err) {
    console.error('POST /webhooks/nextopper DTDC booking', err);
    await sb.from('orders').update({ status: 'needs_review' }).eq('id', order.id);
    await sb.from('shipments').insert([{
      order_id: order.id,
      courier_status: 'failed',
      error_message: err.message,
      retry_count: 0,
    }]);
  }

  res.sendStatus(200);
}));

module.exports = router;
