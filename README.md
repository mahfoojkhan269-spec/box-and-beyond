# Box & Beyond

Receives course-purchase orders from Nextopper via webhook, books the study-material shipment with DTDC automatically, and gives ops staff a dashboard to watch the pipeline and handle failures.

Domain: **boxandbeyondservice.in**
- `api.boxandbeyondservice.in` → backend (Express API)
- `app.boxandbeyondservice.in` → staff dashboard (static `public/` site)

## How it works

See [`docs/nextopper-webhook-api.md`](docs/nextopper-webhook-api.md) for the full API contract to hand to Nextopper's dev team (endpoint, auth, payload shape, response codes).

1. Nextopper calls `POST /api/webhooks/nextopper` the moment a student buys a course. This only saves the order and returns immediately — it does **not** call DTDC inline (see "Built for high volume" below).
2. A background job (`jobs/processBookings.js`, every `DTDC_BOOKING_INTERVAL_MINUTES`) picks up every order still at `status: received` and books it with DTDC (AWB + label), with several bookings in flight at once rather than one at a time.
3. Another background job (`jobs/syncShipments.js`, every `DTDC_SYNC_INTERVAL_MINUTES`) polls DTDC for tracking updates on shipments that aren't delivered yet, records failed delivery attempts (NDR) with their reason, and flags anything stuck too long as `needs_review`.
4. Ops staff log into the dashboard (`app.boxandbeyondservice.in`) to see every order's status, retry failed DTDC bookings, and open shipment labels.

## Built for high volume

This is designed to hold up at "lakhs of orders" scale, not just a few hundred:

- **The webhook never blocks on DTDC.** Booking happens asynchronously in `jobs/processBookings.js`, so a burst of incoming orders (or a slow/down moment on DTDC's side) can't back up or time out Nextopper's own webhook calls.
- **Both background jobs process bounded, concurrency-limited batches** (`lib/concurrency.js`), not one item at a time in a loop — so a large backlog can't make a single scheduled run take longer than the interval before the next one starts.
- **The order list is paginated and searched server-side** (`GET /api/orders?page=&limit=&search=`) — the dashboard only ever holds one page of rows in memory, never the whole table.
- **`supabase/schema.sql` indexes what the app actually queries at scale**: `(status, received_at)` for the paginated/filtered list and the booking queue, and `pg_trgm` GIN indexes so student-name/order-id search stays fast well past the point where a plain index would only help exact/prefix matches.
- Webhook signature failures and every inbound call are still logged (`webhook_logs`), which itself gets slower to page through at huge volume — no retention/pruning policy exists yet, worth adding before this table gets enormous.

## Setup

1. Create a Supabase project, then run `supabase/schema.sql` in its SQL editor.
2. Create the 2-3 staff logins in Supabase Auth (dashboard → Authentication → Users → Add user). No signup flow exists in this app on purpose.
3. `cd backend && npm install`, copy `.env.example` to `.env` and fill in the values (see below).
4. `npm run dev` to run locally (default port 4100).
5. Serve `public/` with any static file server for local testing — `public/config.js` already points at `localhost:4100` for local dev and `api.boxandbeyondservice.in` for anything else.

## Testing before going live

See [`docs/testing.md`](docs/testing.md) for the full checklist — a staging environment, `DTDC_MOCK=true` mode (test the whole pipeline without real DTDC credentials), `backend/scripts/send-test-webhook.js` (simulate Nextopper with a real signature), and `backend/scripts/seed-orders.js` (load-test pagination/search/jobs at real order volume).

## Before going live — placeholders to replace

This was built without Nextopper's real webhook contract or DTDC's real API docs/credentials, so two files contain clearly-marked placeholders:

- [ ] **`backend/lib/nextopperWebhook.js`** — get a real sample webhook payload and the actual signing scheme (header name, algorithm) from Nextopper, then update `verifyNextopperSignature` and the field mapping in `normalizeNextopperPayload`. Nothing is lost in the meantime — every raw payload is stored in `orders.raw_payload` regardless of whether the field mapping guessed right.
- [ ] **`backend/lib/dtdc.js`** — get real DTDC API base URL, auth scheme, and request/response shapes for creating a shipment and checking tracking status, then update `createDtdcShipment` and `getDtdcTrackingStatus`. Everything DTDC-specific is isolated to this one file.
- [ ] Create the real staff accounts in Supabase Auth.
- [ ] Set `NEXTOPPER_WEBHOOK_SECRET` to the value both sides agree on.
- [ ] Point DNS: `api.boxandbeyondservice.in` → backend host, `app.boxandbeyondservice.in` → static site host.

## Environment variables

See `backend/.env.example` for the full list. `CORS_ORIGIN` already defaults to `https://app.boxandbeyondservice.in` in production.

## Deployment

Deploy `backend/` as a Render Web Service (same as this developer's other Node/Express + Supabase projects) with a custom domain of `api.boxandbeyondservice.in`. Serve `public/` as a static site (Render Static Site, Netlify, or any static host) with a custom domain of `app.boxandbeyondservice.in`.
