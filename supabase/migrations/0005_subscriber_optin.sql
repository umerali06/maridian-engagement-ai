alter table subscribers
  add column if not exists opted_in boolean default false,
  add column if not exists last_interaction_at timestamptz default now();

create index if not exists subscribers_last_interaction_idx
  on subscribers(last_interaction_at desc);
