# Box & Beyond

Receives course-purchase orders from Nextopper via webhook, books the study-material shipment with DTDC automatically, and gives ops staff a dashboard to watch the pipeline and handle failures.

Live URLs (using Render's free `onrender.com` subdomains directly — no custom domain wired up yet, by choice, to avoid Render's paid custom-domain slot):
- https://box-and-beyond-api.onrender.com → backend (Express API)
- https://box-and-beyond-app.onrender.com → staff dashboard (static `public/` site)

The domain **boxandbeyondservices.in** is owned but not pointed at anything yet. `api.boxandbeyondservices.in` / `app.boxandbeyondservices.in` are registered as custom domains on Render (waiting on DNS) for whenever you're ready to switch — see **Deployment** below for the exact CNAME records and how to cut over.

## How it works

See [`docs/nextopper-webhook-api.md`](docs/nextopper-webhook-api.md) for the full API contract to hand to Nextopper's dev team (endpoint, auth, payload shape, response codes).

1. Nextopper calls `POST /api/webhooks/nextopper` the moment a student buys a course. This only saves the order and returns immediately — it does **not** call DTDC inline (see "Built for high volume" below).
2. A background job (`jobs/processBookings.js`, every `DTDC_BOOKING_INTERVAL_MINUTES`) picks up every order still at `status: received` and books it with DTDC (AWB + label), with several bookings in flight at once rather than one at a time.
3. Another background job (`jobs/syncShipments.js`, every `DTDC_SYNC_INTERVAL_MINUTES`) polls DTDC for tracking updates on shipments that aren't delivered yet, records failed delivery attempts (NDR) with their reason, and flags anything stuck too long as `needs_review`.
4. Ops staff log into the dashboard (https://box-and-beyond-app.onrender.com) to see every order's status, retry failed DTDC bookings, and open shipment labels.

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
5. Serve `public/` with any static file server for local testing — `public/config.js` already points at `localhost:4100` for local dev and `https://box-and-beyond-api.onrender.com` for anything else.

## Testing before going live

See [`docs/testing.md`](docs/testing.md) for the full checklist — a staging environment, `DTDC_MOCK=true` mode (test the whole pipeline without real DTDC credentials), `backend/scripts/send-test-webhook.js` (simulate Nextopper with a real signature), and `backend/scripts/seed-orders.js` (load-test pagination/search/jobs at real order volume).

## Before going live — placeholders to replace

This was built without Nextopper's real webhook contract or DTDC's real API docs/credentials, so two files contain clearly-marked placeholders:

- [ ] **`backend/lib/nextopperWebhook.js`** — get a real sample webhook payload and the actual signing scheme (header name, algorithm) from Nextopper, then update `verifyNextopperSignature` and the field mapping in `normalizeNextopperPayload`. Nothing is lost in the meantime — every raw payload is stored in `orders.raw_payload` regardless of whether the field mapping guessed right.
- [ ] **`backend/lib/dtdc.js`** — get real DTDC API base URL, auth scheme, and request/response shapes for creating a shipment and checking tracking status, then update `createDtdcShipment` and `getDtdcTrackingStatus`. Everything DTDC-specific is isolated to this one file.
- [ ] Create the real staff accounts in Supabase Auth.
- [ ] Set `NEXTOPPER_WEBHOOK_SECRET` to the value both sides agree on.
- [ ] Point DNS and cut over to the custom domain — currently running on the free `onrender.com` URLs by choice (see **Deployment** below).
- [ ] Turn off `DTDC_MOCK` (currently `true` in production — see below) once real DTDC credentials are in place.

## Environment variables

See `backend/.env.example` for the full list. `CORS_ORIGIN` currently points at `https://box-and-beyond-app.onrender.com` (the dashboard's live URL).

## Deployment

Live on Render, free tier, both services auto-deploy from `master`:

- **Backend** — Render Web Service `box-and-beyond-api`, root dir `backend`, build `npm install`, start `npm start`. Live at: https://box-and-beyond-api.onrender.com
- **Frontend** — Render Static Site `box-and-beyond-app`, publish dir `public`. Live at: https://box-and-beyond-app.onrender.com

Both services are on the **free tier** — it spins down after 15 minutes of inactivity, which delays webhook responses and can skip scheduled cron runs. Upgrade to a paid plan (`$7/mo` Starter, at minimum for the backend) before pointing Nextopper's real webhook at this.

### Switching to the boxandbeyondservices.in domain later

`api.boxandbeyondservices.in` and `app.boxandbeyondservices.in` are already registered as custom domains on the respective Render services, waiting on DNS — add these two CNAME records at your domain registrar whenever you want to cut over:

| Host | Points to |
|---|---|
| `api` | `box-and-beyond-api.onrender.com` |
| `app` | `box-and-beyond-app.onrender.com` |

Render auto-issues SSL once each CNAME resolves (can take up to 24h). After that, update `public/config.js`'s `API_BASE` and the backend's `CORS_ORIGIN` env var back to the `boxandbeyondservices.in` addresses.

**Note:** these two custom-domain slots were freed up by removing the (unverified, never-completed) custom domains from the `gymflow-backend` / `gymflow-frontend` services on this same Render account, since the account's plan only includes 2 free custom domains. A third slot (e.g. for the bare `boxandbeyondservices.in` with no subdomain) costs $0.25/month and needs a payment method on the account — skipped for now.
