/**
 * Thin adapter around DTDC's shipment API.
 *
 * PLACEHOLDER: we don't have real DTDC API credentials/docs yet. This is
 * shaped after DTDC's publicly-documented "OneStop" REST API style (JSON
 * over HTTPS, API-key header, a create-shipment endpoint returning an AWB
 * number, and a tracking endpoint keyed by that AWB). Everything DTDC-specific
 * lives in this one file — once real credentials/docs arrive, only this file
 * should need to change; callers (routes, cron job) only see the functions below.
 */

function creds() {
  const baseUrl = process.env.DTDC_API_BASE_URL;
  const apiKey = process.env.DTDC_API_KEY;
  const customerCode = process.env.DTDC_CUSTOMER_CODE;
  if (!baseUrl || !apiKey || !customerCode) {
    throw new Error('DTDC_API_BASE_URL / DTDC_API_KEY / DTDC_CUSTOMER_CODE not configured');
  }
  return { baseUrl, apiKey, customerCode };
}

/**
 * Books a shipment for the given order row and returns the AWB + label URL.
 * @param {object} order a row from the `orders` table
 * @returns {Promise<{ awb: string, referenceNumber: string, labelUrl: string }>}
 */
async function createDtdcShipment(order) {
  const { baseUrl, apiKey, customerCode } = creds();

  const payload = {
    customer_code: customerCode,
    reference_number: order.nextopper_order_id,
    consignee: {
      name: order.student_name,
      phone: order.phone,
      address_line1: order.address_line1,
      address_line2: order.address_line2 || undefined,
      city: order.city,
      state: order.state,
      pincode: order.pincode,
    },
    // PLACEHOLDER: DTDC will need declared weight/dimensions per shipment —
    // confirm what's required (fixed kit weight vs per-order) once we have docs.
    items: order.kit_items,
  };

  const res = await fetch(`${baseUrl}/api/v1/shipments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `DTDC shipment creation failed (HTTP ${res.status})`);

  return {
    awb: data.awb_number,
    referenceNumber: data.reference_number,
    labelUrl: data.label_url,
  };
}

/**
 * Fetches the current courier status for an AWB.
 * @returns {Promise<{ status: string, lastUpdatedAt: string }>}
 */
async function getDtdcTrackingStatus(awb) {
  const { baseUrl, apiKey } = creds();

  const res = await fetch(`${baseUrl}/api/v1/shipments/${encodeURIComponent(awb)}/track`, {
    headers: { 'x-api-key': apiKey },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `DTDC tracking lookup failed (HTTP ${res.status})`);

  return {
    status: data.status,
    lastUpdatedAt: data.last_updated_at,
  };
}

module.exports = { createDtdcShipment, getDtdcTrackingStatus };
