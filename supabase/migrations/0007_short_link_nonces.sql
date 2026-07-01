create table if not exists short_link_nonces (
  nonce text primary key,
  brand_id uuid not null references brands(id) on delete cascade,
  subscriber_id uuid not null references subscribers(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  persona text not null,
  utm_campaign text not null,
  utm_content text,
  created_at timestamptz default now(),
  clicked_at timestamptz
);

create index if not exists short_link_nonces_created_idx
  on short_link_nonces(created_at);
