/**
 * Inserts a large batch of fake orders directly (bypassing the webhook, for
 * speed) so you can load-test pagination, search, and the booking/sync jobs
 * against real order volume before going live.
 *
 * Usage:
 *   node scripts/seed-orders.js 5000            # insert 5,000 fake 'received' orders
 *   node scripts/seed-orders.js 5000 --booked    # insert them already 'shipment_created' with a mock AWB,
 *                                                 # to load-test the dashboard/sync job without re-running the booking queue
 *
 * Requires SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in backend/.env.
 * Safe to run against a staging Supabase project only — do not run this
 * against production.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { serviceClient } = require('../lib/supabase');

const count = parseInt(process.argv[2], 10) || 1000;
const preBooked = process.argv.includes('--booked');
const CHUNK_SIZE = 500;

const FIRST_NAMES = ['Asha', 'Rohan', 'Priya', 'Karan', 'Sneha', 'Aditya', 'Neha', 'Vivek', 'Kiran', 'Riya'];
const CITIES = [
  ['Pune', 'Maharashtra', '411001'], ['Kolkata', 'West Bengal', '700016'], ['Kochi', 'Kerala', '682001'],
  ['Chennai', 'Tamil Nadu', '600002'], ['Jaipur', 'Rajasthan', '302017'], ['Bengaluru', 'Karnataka', '560001'],
];
const COURSES = ['NEET Foundation 2026', 'JEE Crash Course', 'CLAT Prep', 'UPSC Foundation'];

function randomOrder(i) {
  const name = FIRST_NAMES[i % FIRST_NAMES.length];
  const [city, state, pincode] = CITIES[i % CITIES.length];
  const receivedAt = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    nextopper_order_id: `SEED-${Date.now()}-${i}`,
    student_name: `${name} Seed${i}`,
    phone: `9${String(100000000 + i).slice(0, 9)}`,
    email: `seed${i}@example.com`,
    address_line1: `${i} Test Street`,
    city, state, pincode,
    course_name: COURSES[i % COURSES.length],
    kit_items: [{ name: 'Workbook', quantity: 1 }],
    raw_payload: { seeded: true },
    status: preBooked ? 'shipment_created' : 'received',
    received_at: receivedAt,
  };
}

async function main() {
  const sb = serviceClient();
  console.log(`Seeding ${count} order(s)${preBooked ? ' (pre-booked)' : ''}...`);

  for (let start = 0; start < count; start += CHUNK_SIZE) {
    const chunk = Array.from({ length: Math.min(CHUNK_SIZE, count - start) }, (_, j) => randomOrder(start + j));
    const { data: orders, error } = await sb.from('orders').insert(chunk).select('id');
    if (error) { console.error('Insert failed:', error); process.exit(1); }

    if (preBooked && orders?.length) {
      const shipments = orders.map((o, j) => ({
        order_id: o.id,
        dtdc_awb_number: `SEEDAWB${start + j}`,
        dtdc_reference: `SEED-${start + j}`,
        courier_status: 'booked',
        last_synced_at: new Date().toISOString(),
      }));
      const { error: shipErr } = await sb.from('shipments').insert(shipments);
      if (shipErr) console.error('Shipment insert failed:', shipErr);
    }

    console.log(`  ${Math.min(start + CHUNK_SIZE, count)} / ${count}`);
  }

  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
