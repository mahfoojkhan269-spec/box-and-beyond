const { createDtdcShipment } = require('./dtdc');
const { setOrderStatus } = require('./orderEvents');

/**
 * Attempts to book a DTDC shipment for one order and records the outcome
 * (success or failure) as a shipment row + status event. Shared by the
 * booking queue (jobs/processBookings.js) and the manual "Retry shipment"
 * dashboard action — both do exactly this, just triggered differently.
 */
async function bookOrderShipment(sb, order, { note } = {}) {
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
    await setOrderStatus(sb, order.id, 'shipment_created', note);
    return { ok: true };
  } catch (err) {
    await sb.from('shipments').insert([{
      order_id: order.id,
      courier_status: 'failed',
      error_message: err.message,
    }]);
    await setOrderStatus(sb, order.id, 'needs_review', `DTDC booking failed: ${err.message}`);
    return { ok: false, error: err };
  }
}

module.exports = { bookOrderShipment };
