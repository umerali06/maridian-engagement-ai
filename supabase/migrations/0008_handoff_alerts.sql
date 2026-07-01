create table if not exists handoff_alerts (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  created_at timestamptz default now()
);

create index if not exists handoff_alerts_conv_created_idx
  on handoff_alerts(conversation_id, created_at desc);
