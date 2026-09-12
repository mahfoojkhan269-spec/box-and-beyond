# Box & Beyond

Receives course-purchase orders from Nextopper via webhook, books the study-material shipment with DTDC automatically, and gives ops staff a dashboard to watch the pipeline and handle failures.

Domain: **boxandbeyondservice.in**
- `api.boxandbeyondservice.in` → backend (Express API)
- `app.boxandbeyondservice.in` → staff dashboard (static `public/` site)

## How it works

See [`docs/nextopper-webhook-api.md`](docs/nextopper-webhook-api.md) for the full API contract to hand to Nextopper's dev team (endpoint, auth, payload shape, response codes).

1. Nextopper calls `POST /api/webhooks/nextopper` the moment a student buys a course.
2. We verify the request signature, store the order, and immediately call DTDC's API to book a shipment (AWB + label).
3. A background job polls DTDC every `DTDC_SYNC_INTERVAL_MINUTES` for tracking updates on shipments that aren't delivered yet, and flags anything stuck too long as `needs_review`.
4. Ops staff log into the dashboard (`app.boxandbeyondservice.in`) to see every order's status, retry failed DTDC bookings, and open shipment labels.

## Setup

1. Create a Supabase project, then run `supabase/schema.sql` in its SQL editor.
2. Create the 2-3 staff logins in Supabase Auth (dashboard → Authentication → Users → Add user). No signup flow exists in this app on purpose.
3. `cd backend && npm install`, copy `.env.example` to `.env` and fill in the values (see below).
4. `npm run dev` to run locally (default port 4100).
5. Serve `public/` with any static file server for local testing — `public/config.js` already points at `localhost:4100` for local dev and `api.boxandbeyondservice.in` for anything else.

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
