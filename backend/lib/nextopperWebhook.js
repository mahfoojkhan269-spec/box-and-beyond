const crypto = require('crypto');

/**
 * Verifies the request really came from Nextopper, using a shared secret.
 * Fails CLOSED: a missing/misconfigured secret or signature rejects the
 * request rather than silently accepting everything.
 *
 * PLACEHOLDER: we don't have Nextopper's real signing scheme yet. This
 * assumes the common convention — an `X-Nextopper-Signature: sha256=<hex>`
 * header over the raw request body, HMAC-SHA256 with a shared secret.
 * Confirm the actual header name / algorithm with Nextopper and adjust here.
 */
function verifyNextopperSignature(req) {
  const secret = process.env.NEXTOPPER_WEBHOOK_SECRET;
  if (!secret) return false;
  const signature = req.get('x-nextopper-signature');
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Maps Nextopper's webhook payload onto our `orders` row shape.
 *
 * PLACEHOLDER FIELD NAMES: we don't have Nextopper's real payload schema yet.
 * These are guesses at reasonable field names for a course-purchase order
 * with a physical kit shipment. `raw_payload` always stores the untouched
 * body too, so nothing is lost if these guesses are wrong — update this
 * mapping once Nextopper shares a real sample payload, no schema change needed.
 */
function normalizeNextopperPayload(body) {
  const order = body || {};
  const student = order.student || order.customer || {};
  const address = order.shipping_address || order.address || {};

  return {
    nextopper_order_id: String(order.order_id ?? order.id ?? ''),
    student_name: student.name ?? order.student_name ?? '',
    phone: student.phone ?? order.phone ?? '',
    email: student.email ?? order.email ?? '',
    address_line1: address.line1 ?? address.address1 ?? '',
    address_line2: address.line2 ?? address.address2 ?? '',
    city: address.city ?? '',
    state: address.state ?? '',
    pincode: address.pincode ?? address.zip ?? '',
    course_name: order.course_name ?? order.course?.name ?? '',
    kit_items: order.kit_items ?? order.items ?? [],
    raw_payload: body,
  };
}

module.exports = { verifyNextopperSignature, normalizeNextopperPayload };
