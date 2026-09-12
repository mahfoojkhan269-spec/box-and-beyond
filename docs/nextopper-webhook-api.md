# Box & Beyond — Order Webhook API (for Nextopper's dev team)

This is what Nextopper's system should call whenever a student completes a course purchase that includes a physical kit/book shipment. We receive it, store the order, and automatically book the DTDC shipment on our side — no action needed from Nextopper beyond calling this once per order.

## Endpoint

```
POST https://api.boxandbeyondservices.in/api/webhooks/nextopper
Content-Type: application/json
```

## Authentication

Every request must be signed with HMAC-SHA256 over the raw request body, using a shared secret we'll exchange with you out-of-band (never over email/chat in plaintext).

```
X-Nextopper-Signature: sha256=<hex-encoded HMAC-SHA256 of the raw JSON body, using the shared secret>
```

Example (Node.js):
```js
const crypto = require('crypto');
const signature = 'sha256=' + crypto.createHmac('sha256', SHARED_SECRET).update(rawBodyString).digest('hex');
```

Requests with a missing or invalid signature are rejected with `401`.

## Request body

```json
{
  "order_id": "NXT-2026-00123",
  "student": {
    "name": "Asha Verma",
    "phone": "9876543210",
    "email": "asha@example.com"
  },
  "shipping_address": {
    "line1": "12 MG Road",
    "line2": "Near City Mall",
    "city": "Pune",
    "state": "Maharashtra",
    "pincode": "411001"
  },
  "course_name": "NEET Foundation 2026",
  "kit_items": [
    { "name": "Physics Workbook", "quantity": 1 },
    { "name": "Chemistry Workbook", "quantity": 1 }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `order_id` | Yes | Nextopper's own order/transaction id. Must be unique per order — used as our idempotency key, so a retried/duplicate call with the same `order_id` is safely ignored rather than creating a second shipment. |
| `student.name` | Yes | Full name for the shipping label. |
| `student.phone` | Yes | Used by DTDC for delivery contact. |
| `student.email` | No | |
| `shipping_address.line1` | Yes | |
| `shipping_address.line2` | No | |
| `shipping_address.city` | Yes | |
| `shipping_address.state` | Yes | |
| `shipping_address.pincode` | Yes | |
| `course_name` | Yes | |
| `kit_items` | Yes | Array of `{ name, quantity }` — whatever's physically going in the box. |

**Field names above are our proposed contract, not fixed** — if Nextopper's system already produces a different shape (e.g. `customer` instead of `student`, flat address fields), tell us and we'll match it rather than asking you to reshape your data.

## Response

| Status | Meaning |
|---|---|
| `200` | Received. This is returned whether or not the DTDC shipment booking succeeded — a booking failure on our end is our problem to retry, not something Nextopper should resend for. |
| `400` | Payload rejected (e.g. missing `order_id`) — check the request body. |
| `401` | Signature missing or invalid — check the shared secret and signing method. |

**Please don't build automatic retries on non-200 responses beyond standard transient-failure handling (e.g. a connection timeout).** We log every call (valid or not) and handle failed shipment bookings ourselves via an internal retry/review queue, so repeated identical calls just add noise.

## Test/staging

Before going live, we'll set up a staging secret and staging endpoint (`https://staging-api.boxandbeyondservices.in/api/webhooks/nextopper` or similar) so both sides can verify a handful of real-shaped test orders end-to-end before real student data flows through it.

## Open items before this goes live

- [ ] Confirm the field names/shape above match what Nextopper's system actually produces, or agree on the differences.
- [ ] Exchange the shared HMAC secret over a secure channel (not email/Slack in plaintext).
- [ ] Agree on a staging window to test with sample orders.
