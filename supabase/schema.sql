-- Nextopper Shipments Portal — schema
-- Run this in the Supabase SQL editor for a fresh project.

create extension if not exists "pgcrypto";
-- Powers fast ILIKE '%term%' search on student_name / nextopper_order_id at
-- high row counts (a plain btree only helps prefix matches, not "contains").
create extension if not exists "pg_trgm";

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  nextopper_order_id text unique not null,
  student_name text not null default '',
  phone text not null default '',
  email text not null default '',
  address_line1 text not null default '',
  address_line2 text not null default '',
  city text not null default '',
  state text not null default '',
  pincode text not null default '',
  course_name text not null default '',
  kit_items jsonb not null default '[]',
  raw_payload jsonb not null default '{}',
  status text not null default 'received'
    check (status in ('received', 'shipment_created', 'dispatched', 'delivered', 'failed', 'needs_review')),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  dtdc_awb_number text,
  dtdc_reference text,
  label_url text,
  courier_status text,
  last_synced_at timestamptz,
  error_message text,
  retry_count int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists webhook_logs (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  signature_valid boolean not null,
  body jsonb,
  error text
);

-- Every order.status transition, so the dashboard can show a full timeline
-- instead of just the current state. `note` carries the reason for the
-- transition when there is one (e.g. a DTDC booking error).
create table if not exists order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status text not null,
  note text,
  created_at timestamptz not null default now()
);

-- One row per DTDC delivery attempt that came back non-delivered (NDR) —
-- distinct from a *booking* failure (that's `shipments.error_message`).
-- An NDR means DTDC physically attempted delivery and it didn't go through
-- (customer unavailable, address issue, refused, etc).
create table if not exists delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  ndr_reason text,
  raw_status jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_shipments_order_id on shipments(order_id);
create index if not exists idx_shipments_courier_status on shipments(courier_status);
create index if not exists idx_shipments_last_synced_at on shipments(last_synced_at);
create index if not exists idx_orders_status on orders(status);
-- Covers "list orders, optionally by status, newest first" — the dashboard's
-- main query and the booking queue's "oldest received first" query both hit this.
create index if not exists idx_orders_status_received_at on orders(status, received_at);
create index if not exists idx_orders_received_at on orders(received_at desc);
create index if not exists idx_orders_student_name_trgm on orders using gin (student_name gin_trgm_ops);
create index if not exists idx_orders_nextopper_order_id_trgm on orders using gin (nextopper_order_id gin_trgm_ops);
create index if not exists idx_order_events_order_id on order_events(order_id);
create index if not exists idx_delivery_attempts_order_id on delivery_attempts(order_id);

-- RLS: this portal has only a handful of pre-created ops-staff accounts and
-- no multi-tenant separation, so any authenticated user may read/write every
-- row. The webhook and sync job use the service-role key and bypass RLS.
alter table orders enable row level security;
alter table shipments enable row level security;
alter table webhook_logs enable row level security;
alter table order_events enable row level security;
alter table delivery_attempts enable row level security;

create policy "staff can read orders" on orders for select to authenticated using (true);
create policy "staff can update orders" on orders for update to authenticated using (true);

create policy "staff can read shipments" on shipments for select to authenticated using (true);
create policy "staff can insert shipments" on shipments for insert to authenticated with check (true);
create policy "staff can update shipments" on shipments for update to authenticated using (true);

create policy "staff can read webhook logs" on webhook_logs for select to authenticated using (true);

create policy "staff can read order events" on order_events for select to authenticated using (true);
create policy "staff can read delivery attempts" on delivery_attempts for select to authenticated using (true);
