/**
 * Simulates Nextopper calling our webhook — computes a real HMAC signature
 * with NEXTOPPER_WEBHOOK_SECRET (from backend/.env) and POSTs a sample order.
 *
 * Usage:
 *   node scripts/send-test-webhook.js                  # valid signature, random order id
 *   node scripts/send-test-webhook.js --bad-signature   # expect 401
 *   node scripts/send-test-webhook.js --order-id NXT-1  # send a specific/repeatable order id (to test idempotency)
 *   node scripts/send-test-webhook.js --fail-booking    # pincode 000000 — triggers DTDC_MOCK's simulated booking failure
 *   node scripts/send-test-webhook.js --url http://localhost:4100
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const baseUrl = value('--url', `http://localhost:${process.env.PORT || 4100}`);
const orderId = value('--order-id', `TEST-${Date.now()}`);

const body = {
  order_id: orderId,
  student: { name: 'Test Student', phone: '9999999999', email: 'test@example.com' },
  shipping_address: {
    line1: '1 Test Street',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: flag('--fail-booking') ? '000000' : '560001',
  },
  course_name: 'Test Course',
  kit_items: [{ name: 'Test Workbook', quantity: 1 }],
};

async function main() {
  const raw = JSON.stringify(body);
  const secret = process.env.NEXTOPPER_WEBHOOK_SECRET;
  if (!secret) throw new Error('NEXTOPPER_WEBHOOK_SECRET not set in backend/.env');

  const signature = flag('--bad-signature')
    ? 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
    : 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

  const res = await fetch(`${baseUrl}/api/webhooks/nextopper`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Nextopper-Signature': signature },
    body: raw,
  });

  console.log(`POST /api/webhooks/nextopper -> HTTP ${res.status}`);
  console.log(`order_id: ${orderId}`);
  const text = await res.text();
  if (text) console.log(text);
}

main().catch(err => { console.error(err); process.exit(1); });
