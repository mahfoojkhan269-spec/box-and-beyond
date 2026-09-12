# Testing before going live

## 1. Set up a staging environment (do this first)

Never test against the same Supabase project / Render service that will hold real student data.

1. Create a **second** Supabase project just for staging. Run `supabase/schema.sql` in it.
2. Create one test staff account in its Auth tab.
3. Run the backend locally (or as a separate Render service) pointed at this staging project's `SUPABASE_URL` / keys.
4. Set `DTDC_MOCK=true` in `backend/.env` — see below.

## 2. DTDC mock mode — test the whole pipeline without real credentials

We don't have real DTDC API access yet. `backend/lib/dtdc.js` has a mock mode for exactly this: set `DTDC_MOCK=true` and:

- `createDtdcShipment` returns a fake AWB/label instantly — **except** an order with `pincode: '000000'`, which always fails, so you can reliably test the `needs_review` + retry path without waiting for a real failure.
- `getDtdcTrackingStatus` deterministically returns `booked` → `in_transit` → `delivered` over a ~20-minute wall-clock cycle, and ~5% of AWBs (by hash) permanently return `ndr` with a reason — so running `syncShipments` a few times in a row shows real status transitions and NDR handling, not a static value.

**Never set `DTDC_MOCK=true` in production.**

## 3. Simulate Nextopper's webhook

`backend/scripts/send-test-webhook.js` computes a real HMAC signature with your `NEXTOPPER_WEBHOOK_SECRET` and posts a sample order, so you can test the actual signature-verification code path, not just the happy path:

```bash
node scripts/send-test-webhook.js                  # normal order, valid signature -> expect 200
node scripts/send-test-webhook.js --bad-signature   # -> expect 401
node scripts/send-test-webhook.js --order-id NXT-1  # send the same order id twice -> second call should be a no-op, not a duplicate booking
node scripts/send-test-webhook.js --fail-booking    # pincode 000000 with DTDC_MOCK=true -> order should land in needs_review
```

After sending a few, check:
- [ ] The order appears in the dashboard with the right student/course details.
- [ ] Sending the same `--order-id` twice does **not** create a second row or a second shipment.
- [ ] `--fail-booking` order shows up under "Needs review" once `processBookings` runs, with the DTDC error message visible in its status history.
- [ ] "Retry shipment" on that order succeeds (use a normal pincode this time — you'll need to fix the address first, same as ops would for a real bad-address case).
- [ ] The Webhook Logs view shows every one of these calls, including the `--bad-signature` one marked invalid.

## 4. Load-test at real volume

`backend/scripts/seed-orders.js` inserts fake orders directly (bypassing the webhook, for speed) so you can test at the volume this is actually built for:

```bash
node scripts/seed-orders.js 5000            # 5,000 orders at status 'received' — tests the booking queue draining them
node scripts/seed-orders.js 100000 --booked  # 100,000 already-booked orders — tests dashboard pagination/search without waiting on the booking queue
```

After seeding, check:
- [ ] The dashboard's KPI header and pagination ("Page X of Y · N orders") reflect the real count without the page hanging.
- [ ] Searching by a seeded student name or order id returns quickly (this is what `pg_trgm` in `schema.sql` is for — if it's slow, confirm those indexes actually got created).
- [ ] With `DTDC_MOCK=true` and a batch of `received` orders seeded, watch `processBookings` logs — it should process them in bounded batches, not all at once or one at a time taking forever.
- [ ] Same for `syncShipments` against a batch of `--booked` orders.

**Clean up seeded data afterward** — `delete from orders where raw_payload->>'seeded' = 'true';` (cascades to `shipments`/`order_events`/`delivery_attempts`) — so it doesn't linger in a project you later promote to production.

## 5. Manual QA pass (staging, with a real browser)

- [ ] Log in, log out, reload the page mid-session (confirms the refresh-token flow keeps you logged in).
- [ ] Every nav item (Orders / Needs review / Webhook logs) shows the right data and title.
- [ ] Status filter dropdown and search box both work and reset correctly when switching views.
- [ ] Mobile width (resize the browser narrow) — sidebar collapses to a top bar, everything still usable.
- [ ] "Mark delivered" and "Retry shipment" both update the row and the KPI counts without a full page reload.

## 6. Security sanity checks

- [ ] `CORS_ORIGIN` in production is the real dashboard domain, never `*`.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is only ever in the backend's env, never sent to or readable from the frontend.
- [ ] A request to any `/api/orders*` route without a valid `Authorization` header gets `401`.
- [ ] `NEXTOPPER_WEBHOOK_SECRET` is a long random value, not something guessable, and was exchanged with Nextopper over a secure channel.

## 7. Before flipping DTDC_MOCK off for real traffic

- [ ] Real DTDC credentials are in `backend/.env` (or Render's env vars) and `DTDC_MOCK` is unset or `false`.
- [ ] Send one real test shipment through the real DTDC API in whatever sandbox/test mode they offer, if any, before the first real student order.
