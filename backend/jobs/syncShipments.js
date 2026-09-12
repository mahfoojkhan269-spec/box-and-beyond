const { serviceClient } = require('../lib/supabase');
const { getDtdcTrackingStatus } = require('../lib/dtdc');
const { setOrderStatus } = require('../lib/orderEvents');

const STUCK_AFTER_MS = 48 * 60 * 60 * 1000; // 48h with no DTDC status change -> flag for a human

// PLACEHOLDER: confirm DTDC's real status vocabulary once we have their docs —
// this assumes 'ndr' marks a failed delivery attempt distinct from 'delivered'/'in_transit'.
const STATUS_TO_ORDER_STATUS = {
  delivered: 'delivered',
  in_transit: 'dispatched',
  ndr: 'needs_review',
};

/**
 * Polls DTDC for every shipment that isn't in a terminal state, updates our
 * copy of the status, records any failed delivery attempt (NDR) with its
 * reason, and flags anything stuck too long as needs_review.
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
      const { status, lastUpdatedAt, ndrReason } = await getDtdcTrackingStatus(shipment.dtdc_awb_number);
      await sb.from('shipments').update({
        courier_status: status,
        last_synced_at: new Date().toISOString(),
      }).eq('id', shipment.id);

      if (status === 'ndr') {
        await sb.from('delivery_attempts').insert([{
          shipment_id: shipment.id,
          order_id: shipment.order_id,
          ndr_reason: ndrReason,
          raw_status: { status, lastUpdatedAt },
        }]);
      }

      const newOrderStatus = STATUS_TO_ORDER_STATUS[status];
      if (newOrderStatus && newOrderStatus !== shipment.orders?.status) {
        const note = status === 'ndr' ? `Delivery attempt failed: ${ndrReason || 'no reason given by DTDC'}` : null;
        await setOrderStatus(sb, shipment.order_id, newOrderStatus, note);
      }

      const stuck = shipment.last_synced_at && (Date.now() - new Date(shipment.last_synced_at).getTime()) > STUCK_AFTER_MS;
      if (stuck && status !== 'delivered' && shipment.orders?.status !== 'needs_review') {
        await setOrderStatus(sb, shipment.order_id, 'needs_review', `No DTDC status update in over 48 hours (last status: ${status}).`);
      }
    } catch (err) {
      console.error(`[syncShipments] Tracking lookup failed for AWB ${shipment.dtdc_awb_number}:`, err.message);
    }
  }
}

module.exports = { syncShipments };
