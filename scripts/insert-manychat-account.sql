-- =============================================================================
-- Conecta la cuenta ManyChat de @josue.melero al brand 'meridian'.
-- Corre esto en Supabase SQL Editor DESPUÉS de 0001_initial_schema.sql.
-- =============================================================================

insert into manychat_accounts (
  brand_id,
  platform,
  display_name,
  manychat_api_key,
  manychat_page_id
)
select
  b.id,
  'instagram',
  '@josue.melero — Meridian',
  'REPLACE_WITH_MANYCHAT_API_TOKEN',  -- format: <page_id>:<token>
  'REPLACE_WITH_MANYCHAT_PAGE_ID'
from brands b
where b.slug = 'meridian'
on conflict (manychat_page_id) do nothing;

-- Verifica
select b.name as brand, a.display_name, a.platform, a.manychat_page_id, a.active
from manychat_accounts a
join brands b on b.id = a.brand_id;
