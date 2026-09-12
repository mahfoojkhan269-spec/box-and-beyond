const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { friendlyDbError } = require('../lib/friendlyError');
const asyncHandler = require('../lib/asyncHandler');
const { createDtdcShipment } = require('../lib/dtdc');

const router = express.Router();
router.use(requireAuth);

/** GET /api/orders — list orders with their latest shipment, newest first. Optional ?status=needs_review filter. */
router.get('/', asyncHandler(async (req, res) => {
  let query = req.sb.from('orders').select('*, shipments(*)').order('received_at', { ascending: false });
  if (req.query.status) query = query.eq('status', req.query.status);

  const { data, error } = await query;
  if (error) { console.error('GET /orders', error); return res.status(400).json({ error: friendlyDbError(error) }); }
  res.json({ orders: data });
}));

/** GET /api/orders/:id — single order with its shipment history. */
router.get('/:id', asyncHandler(async (req, res) => {
  const { data, error } = await req.sb.from('orders').select('*, shipments(*)').eq('id', req.params.id).single();
  if (error) { console.error('GET /orders/:id', error); return res.status(404).json({ error: 'Order not found' }); }
  res.json({ order: data });
}));

/** POST /api/orders/:id/retry — re-attempt DTDC shipment creation for a failed/needs_review order. */
router.post('/:id/retry', asyncHandler(async (req, res) => {
  const { data: order, error: fetchError } = await req.sb.from('orders').select('*').eq('id', req.params.id).single();
  if (fetchError || !order) return res.status(404).json({ error: 'Order not found' });

  try {
    const shipment = await createDtdcShipment(order);
    const { error } = await req.sb.from('shipments').insert([{
      order_id: order.id,
      dtdc_awb_number: shipment.awb,
      dtdc_reference: shipment.referenceNumber,
      label_url: shipment.labelUrl,
      courier_status: 'booked',
      last_synced_at: new Date().toISOString(),
    }]);
    if (error) { console.error('POST /orders/:id/retry insert', error); return res.status(400).json({ error: friendlyDbError(error) }); }

    await req.sb.from('orders').update({ status: 'shipment_created' }).eq('id', order.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /orders/:id/retry DTDC', err);
    await req.sb.from('shipments').insert([{
      order_id: order.id,
      courier_status: 'failed',
      error_message: err.message,
    }]);
    res.status(502).json({ error: `DTDC booking failed: ${err.message}` });
  }
}));

/** POST /api/orders/:id/mark-delivered — manual override for edge cases DTDC tracking won't catch. */
router.post('/:id/mark-delivered', asyncHandler(async (req, res) => {
  const { data, error } = await req.sb.from('orders').update({ status: 'delivered' }).eq('id', req.params.id).select().single();
  if (error) { console.error('POST /orders/:id/mark-delivered', error); return res.status(400).json({ error: friendlyDbError(error) }); }
  if (!data) return res.status(404).json({ error: 'Order not found' });
  res.json({ order: data });
}));

module.exports = router;
