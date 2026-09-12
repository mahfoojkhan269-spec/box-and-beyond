const { serviceClient } = require('../lib/supabase');
const { getDtdcTrackingStatus } = require('../lib/dtdc');

const STUCK_AFTER_MS = 48 * 60 * 60 * 1000; // 48h with no DTDC status change -> flag for a human

/**
 * Polls DTDC for every shipment that isn't in a terminal state, updates our
 * copy of the status, and flags anything stuck too long as needs_review.
 * Runs on a schedule from server.js — see the cron.schedule call there.
 */
async function syncShipments() {
  const sb = serviceClient();
  const { data: shipments, error } = await sb
    .from('shipments')
    .select('*, orders(id, status)')
    .not('courier_status', 'in', '(delivered,failed)')
    .not('dtdc_awb_number', 'is', null);

  if (error) {
    console.error('[syncShipments] Could not load shipments:', error);
    return;
  }

  for (const shipment of shipments || []) {
    try {
      const { status, lastUpdatedAt } = await getDtdcTrackingStatus(shipment.dtdc_awb_number);
      await sb.from('shipments').update({
        courier_status: status,
        last_synced_at: new Date().toISOString(),
      }).eq('id', shipment.id);

      const orderStatus = status === 'delivered' ? 'delivered' : status === 'in_transit' ? 'dispatched' : shipment.orders?.status;
      if (orderStatus && orderStatus !== shipment.orders?.status) {
        await sb.from('orders').update({ status: orderStatus }).eq('id', shipment.order_id);
      }

      const stuck = shipment.last_synced_at && (Date.now() - new Date(shipment.last_synced_at).getTime()) > STUCK_AFTER_MS;
      if (stuck && status !== 'delivered') {
        await sb.from('orders').update({ status: 'needs_review' }).eq('id', shipment.order_id);
      }
    } catch (err) {
      console.error(`[syncShipments] Tracking lookup failed for AWB ${shipment.dtdc_awb_number}:`, err.message);
    }
  }
}

module.exports = { syncShipments };
