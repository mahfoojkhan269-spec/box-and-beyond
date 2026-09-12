-- Nextopper Shipments Portal — schema
-- Run this in the Supabase SQL editor for a fresh project.

create extension if not exists "pgcrypto";

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

create index if not exists idx_shipments_order_id on shipments(order_id);
create index if not exists idx_orders_status on orders(status);

-- RLS: this portal has only a handful of pre-created ops-staff accounts and
-- no multi-tenant separation, so any authenticated user may read/write every
-- row. The webhook and sync job use the service-role key and bypass RLS.
alter table orders enable row level security;
alter table shipments enable row level security;
alter table webhook_logs enable row level security;

create policy "staff can read orders" on orders for select to authenticated using (true);
create policy "staff can update orders" on orders for update to authenticated using (true);

create policy "staff can read shipments" on shipments for select to authenticated using (true);
create policy "staff can insert shipments" on shipments for insert to authenticated with check (true);
create policy "staff can update shipments" on shipments for update to authenticated using (true);

create policy "staff can read webhook logs" on webhook_logs for select to authenticated using (true);
