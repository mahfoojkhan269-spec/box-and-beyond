/**
 * Appends a row to order_events and updates orders.status in one place, so
 * every status transition is timestamped and (when there's a reason, e.g. a
 * DTDC booking error) noted — the dashboard reads this back as a timeline
 * instead of just showing whatever the current status happens to be.
 */
async function setOrderStatus(sb, orderId, status, note = null) {
  const { error: updateError } = await sb.from('orders').update({ status }).eq('id', orderId);
  if (updateError) { console.error('setOrderStatus update', updateError); return; }

  const { error: eventError } = await sb.from('order_events').insert([{ order_id: orderId, status, note }]);
  if (eventError) console.error('setOrderStatus event log', eventError);
}

module.exports = { setOrderStatus };
