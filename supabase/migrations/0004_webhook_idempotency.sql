create table if not exists webhook_dedup (
  idempotency_key text primary key,
  created_at timestamptz default now()
);

create index if not exists webhook_dedup_created_idx on webhook_dedup(created_at);

-- A nightly cleanup can be added later for rows older than 24 hours.
