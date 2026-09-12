const { serviceClient } = require('../lib/supabase');
const { bookOrderShipment } = require('../lib/booking');
const { mapWithConcurrency } = require('../lib/concurrency');

const BATCH_SIZE = 200; // cap per run so one pass can't run indefinitely under a huge backlog
const CONCURRENCY = 10; // parallel DTDC booking calls in flight at once

/**
 * Books DTDC shipments for every order still sitting at `received` —
 * i.e. every order the Nextopper webhook has saved but not yet shipped.
 *
 * The webhook itself does NOT call DTDC inline anymore (see routes/webhooks.js) —
 * it just persists the order and returns immediately, so a burst of incoming
 * orders never blocks on DTDC's API latency or availability. This job is the
 * actual booking step, running on its own schedule (see server.js) and processing
 * a bounded, concurrency-limited batch each time so a large backlog can't make a
 * single run take longer than the interval between runs.
 */
async function processBookings() {
  const sb = serviceClient();
  const { data: orders, error } = await sb
    .from('orders')
    .select('*')
    .eq('status', 'received')
    .order('received_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error('[processBookings] Could not load pending orders:', error);
    return;
  }
  if (!orders || !orders.length) return;

  const results = await mapWithConcurrency(orders, CONCURRENCY, (order) => bookOrderShipment(sb, order));
  const booked = results.filter(r => r.ok).length;
  console.log(`[processBookings] Processed ${orders.length} order(s): ${booked} booked, ${orders.length - booked} sent to review.`);
}

module.exports = { processBookings };
