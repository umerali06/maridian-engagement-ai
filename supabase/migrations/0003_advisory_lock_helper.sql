create or replace function try_lock_conversation(conv_id uuid)
returns boolean language sql as $$
  select pg_try_advisory_lock(('x' || substr(md5(conv_id::text), 1, 16))::bit(64)::bigint);
$$;

create or replace function unlock_conversation(conv_id uuid)
returns boolean language sql as $$
  select pg_advisory_unlock(('x' || substr(md5(conv_id::text), 1, 16))::bit(64)::bigint);
$$;
