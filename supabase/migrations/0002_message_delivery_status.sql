-- Track outbound message delivery separately from AI generation.
-- This prevents the dashboard from showing a reply as successful when ManyChat rejected it.

alter table messages
  add column if not exists delivery_status text
    check (delivery_status in ('pending', 'delivered', 'failed')),
  add column if not exists delivery_error text,
  add column if not exists delivered_at timestamptz;

create index if not exists messages_delivery_status_idx
  on messages(brand_id, delivery_status, created_at desc);
