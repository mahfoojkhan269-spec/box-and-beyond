const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { friendlyDbError } = require('../lib/friendlyError');
const asyncHandler = require('../lib/asyncHandler');
const { bookOrderShipment } = require('../lib/booking');
const { setOrderStatus } = require('../lib/orderEvents');

const router = express.Router();
router.use(requireAuth);

const ALL_STATUSES = ['received', 'shipment_created', 'dispatched', 'delivered', 'failed', 'needs_review'];
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

/** GET /api/orders/stats — counts by status, for the dashboard's KPI header. Unaffected by any list filter. */
router.get('/stats', asyncHandler(async (req, res) => {
  const counts = {};
  await Promise.all(ALL_STATUSES.map(async (status) => {
    const { count, error } = await req.sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', status);
    if (error) { console.error('GET /orders/stats', status, error); counts[status] = 0; return; }
    counts[status] = count || 0;
  }));
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  res.json({ total, byStatus: counts });
}));

/**
 * GET /api/orders — paginated order list, newest first.
 * Query params: ?status=needs_review &search=<student name or order id> &page=1 &limit=25
 *
 * At the order volumes this is built for (lakhs), returning every matching
 * row in one response — and filtering client-side, as this used to do — stops
 * being viable almost immediately. Pagination and search both run as SQL here;
 * the frontend only ever holds one page's worth of rows in memory.
 */
router.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = req.sb
    .from('orders')
    .select('*, shipments(*)', { count: 'exact' })
    .order('received_at', { ascending: false })
    .range(from, to);

  if (req.query.status) query = query.eq('status', req.query.status);
  if (req.query.search) {
    const term = req.query.search.trim();
    // Matches either the student's name or Nextopper's own order id — the two things
    // an ops person actually has on hand when someone asks "where's my order?"
    query = query.or(`student_name.ilike.%${term}%,nextopper_order_id.ilike.%${term}%`);
  }

  const { data, error, count } = await query;
  if (error) { console.error('GET /orders', error); return res.status(400).json({ error: friendlyDbError(error) }); }
  res.json({ orders: data, total: count ?? 0, page, limit });
}));

/** GET /api/orders/:id — single order with its shipment, status timeline, and any NDR history. */
router.get('/:id', asyncHandler(async (req, res) => {
  const { data, error } = await req.sb
    .from('orders')
    .select('*, shipments(*), order_events(*), delivery_attempts(*)')
    .eq('id', req.params.id)
    .single();
  if (error) { console.error('GET /orders/:id', error); return res.status(404).json({ error: 'Order not found' }); }
  res.json({ order: data });
}));

/** POST /api/orders/:id/retry — re-attempt DTDC shipment creation for a failed/needs_review order. */
router.post('/:id/retry', asyncHandler(async (req, res) => {
  const { data: order, error: fetchError } = await req.sb.from('orders').select('*').eq('id', req.params.id).single();
  if (fetchError || !order) return res.status(404).json({ error: 'Order not found' });

  const result = await bookOrderShipment(req.sb, order, { note: 'Retried manually from the dashboard.' });
  if (!result.ok) return res.status(502).json({ error: `DTDC booking failed: ${result.error.message}` });
  res.json({ ok: true });
}));

/** POST /api/orders/:id/mark-delivered — manual override for edge cases DTDC tracking won't catch. */
router.post('/:id/mark-delivered', asyncHandler(async (req, res) => {
  await setOrderStatus(req.sb, req.params.id, 'delivered', 'Marked delivered manually from the dashboard.');
  const { data, error } = await req.sb.from('orders').select('*').eq('id', req.params.id).single();
  if (error) { console.error('POST /orders/:id/mark-delivered', error); return res.status(400).json({ error: friendlyDbError(error) }); }
  if (!data) return res.status(404).json({ error: 'Order not found' });
  res.json({ order: data });
}));

module.exports = router;
