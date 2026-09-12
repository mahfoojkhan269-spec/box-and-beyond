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

/**
 * Mock mode (DTDC_MOCK=true) — lets us exercise the whole booking queue,
 * retry flow, and status-sync job end-to-end without real DTDC credentials.
 * Use it for local testing and a staging environment before going live.
 *
 * Deterministic on purpose, not random, so a test run is reproducible:
 *   - An order with pincode '000000' always fails booking (tests the
 *     needs_review + retry path without waiting for a real failure).
 *   - ~5% of AWBs (by hash) permanently land in 'ndr' (tests NDR handling).
 *   - Everything else progresses booked -> in_transit -> delivered over a
 *     ~20-minute wall-clock cycle, so running the sync job a few times in a
 *     row shows real status transitions instead of a static value.
 */
const MOCK_MODE = process.env.DTDC_MOCK === 'true';

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function mockCreateDtdcShipment(order) {
  if (order.pincode === '000000') throw new Error('Simulated booking failure (DTDC_MOCK test pincode 000000)');
  const awb = `MOCK${hashCode(order.nextopper_order_id)}`;
  return { awb, referenceNumber: order.nextopper_order_id, labelUrl: `https://example.com/mock-labels/${awb}.pdf` };
}

async function mockGetDtdcTrackingStatus(awb) {
  if (hashCode(awb) % 100 < 5) return { status: 'ndr', lastUpdatedAt: new Date().toISOString(), ndrReason: 'Customer not available (mock)' };
  const cycleMinute = Math.floor(Date.now() / 60000) % 20;
  const status = cycleMinute < 5 ? 'booked' : cycleMinute < 15 ? 'in_transit' : 'delivered';
  return { status, lastUpdatedAt: new Date().toISOString(), ndrReason: null };
}

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
  if (MOCK_MODE) return mockCreateDtdcShipment(order);
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
 *
 * `ndrReason` is populated when DTDC attempted delivery and it failed
 * (customer unavailable, refused, bad address, etc — an "NDR", non-delivery
 * report, in courier terminology) — distinct from never having booked the
 * shipment at all. PLACEHOLDER field name `ndr_reason` — confirm against
 * DTDC's real tracking response shape once we have their docs.
 *
 * @returns {Promise<{ status: string, lastUpdatedAt: string, ndrReason: string|null }>}
 */
async function getDtdcTrackingStatus(awb) {
  if (MOCK_MODE) return mockGetDtdcTrackingStatus(awb);
  const { baseUrl, apiKey } = creds();

  const res = await fetch(`${baseUrl}/api/v1/shipments/${encodeURIComponent(awb)}/track`, {
    headers: { 'x-api-key': apiKey },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `DTDC tracking lookup failed (HTTP ${res.status})`);

  return {
    status: data.status,
    lastUpdatedAt: data.last_updated_at,
    ndrReason: data.ndr_reason || null,
  };
}

module.exports = { createDtdcShipment, getDtdcTrackingStatus };
