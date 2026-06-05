-- =============================================================================
-- Meridian Engagement AI — Initial Schema
-- Run in Supabase SQL Editor (Database > SQL Editor > New query)
-- =============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists vector;
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- BRANDS — multi-tenant root
-- -----------------------------------------------------------------------------
create table if not exists brands (
  id uuid primary key default uuid_generate_v4(),
  slug text unique not null,
  name text not null,
  system_prompt text default '',
  voice_guidelines text default '',
  mandatory_disclaimer text default '',
  handoff_telegram_chat_id text,
  handoff_email text,
  landing_base_url text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- BRAND MEMBERSHIPS — which Supabase users can access which brands
-- -----------------------------------------------------------------------------
create table if not exists brand_memberships (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references brands(id) on delete cascade,
  role text default 'admin' check (role in ('admin','operator','viewer')),
  created_at timestamptz default now(),
  unique(user_id, brand_id)
);

-- -----------------------------------------------------------------------------
-- MANYCHAT ACCOUNTS — one row per IG/FB/WA page connected
-- -----------------------------------------------------------------------------
create table if not exists manychat_accounts (
  id uuid primary key default uuid_generate_v4(),
  brand_id uuid references brands(id) on delete cascade not null,
  platform text not null check (platform in ('instagram','facebook','whatsapp','telegram','sms')),
  display_name text,
  manychat_api_key text not null,
  manychat_page_id text not null,
  active boolean default true,
  created_at timestamptz default now(),
  unique(manychat_page_id)
);

-- -----------------------------------------------------------------------------
-- SUBSCRIBERS — one per ManyChat user
-- -----------------------------------------------------------------------------
create table if not exists subscribers (
  id uuid primary key default uuid_generate_v4(),
  brand_id uuid references brands(id) on delete cascade not null,
  manychat_account_id uuid references manychat_accounts(id) on delete cascade,
  manychat_subscriber_id text not null,
  platform text,
  full_name text,
  first_name text,
  last_name text,
  profile_pic text,
  locale text,
  timezone text,
  email text,
  phone text,
  custom_fields jsonb default '{}'::jsonb,
  tags text[] default array[]::text[],
  detected_persona text,
  lead_score int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(brand_id, manychat_subscriber_id)
);
create index if not exists subscribers_brand_idx on subscribers(brand_id);
create index if not exists subscribers_updated_idx on subscribers(updated_at desc);

-- -----------------------------------------------------------------------------
-- CONVERSATIONS — sessions per subscriber, auto-rotated after 24h idle
-- -----------------------------------------------------------------------------
create table if not exists conversations (
  id uuid primary key default uuid_generate_v4(),
  brand_id uuid references brands(id) on delete cascade not null,
  subscriber_id uuid references subscribers(id) on delete cascade not null,
  status text default 'active' check (status in ('active','handed_off','closed')),
  handoff_reason text,
  handed_off_at timestamptz,
  handed_off_to text,
  last_message_at timestamptz default now(),
  summary text,
  sentiment_score float,
  tags text[] default array[]::text[],
  message_count int default 0,
  created_at timestamptz default now()
);
create index if not exists conversations_brand_idx on conversations(brand_id);
create index if not exists conversations_subscriber_idx on conversations(subscriber_id);
create index if not exists conversations_last_msg_idx on conversations(last_message_at desc);
create index if not exists conversations_status_idx on conversations(status);

-- -----------------------------------------------------------------------------
-- MESSAGES — every turn
-- -----------------------------------------------------------------------------
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid references conversations(id) on delete cascade not null,
  brand_id uuid references brands(id) on delete cascade not null,
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null,
  tool_name text,
  tool_input jsonb,
  tool_result jsonb,
  tokens_input int,
  tokens_output int,
  tokens_cache_read int,
  tokens_cache_creation int,
  latency_ms int,
  model text,
  created_at timestamptz default now()
);
create index if not exists messages_conv_idx on messages(conversation_id, created_at);
create index if not exists messages_brand_created_idx on messages(brand_id, created_at desc);

-- -----------------------------------------------------------------------------
-- DOCUMENTS — knowledge base sources
-- -----------------------------------------------------------------------------
create table if not exists documents (
  id uuid primary key default uuid_generate_v4(),
  brand_id uuid references brands(id) on delete cascade not null,
  title text not null,
  source_type text not null check (source_type in ('pdf','url','manual','docx','txt','md')),
  source_url text,
  file_path text,
  storage_bucket text default 'kb',
  chunk_count int default 0,
  metadata jsonb default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);
create index if not exists documents_brand_idx on documents(brand_id);

-- -----------------------------------------------------------------------------
-- DOCUMENT_CHUNKS — RAG chunks with embeddings
-- -----------------------------------------------------------------------------
create table if not exists document_chunks (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid references documents(id) on delete cascade not null,
  brand_id uuid references brands(id) on delete cascade not null,
  content text not null,
  chunk_index int not null,
  token_count int,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists chunks_brand_idx on document_chunks(brand_id);
create index if not exists chunks_doc_idx on document_chunks(document_id);
-- IVFFlat for fast cosine similarity. Adjust lists higher as data grows (sqrt of rows).
create index if not exists chunks_embedding_idx
  on document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- -----------------------------------------------------------------------------
-- HANDOFFS — audit log of every escalation
-- -----------------------------------------------------------------------------
create table if not exists handoffs (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid references conversations(id) on delete cascade not null,
  brand_id uuid references brands(id) on delete cascade not null,
  reason text not null,
  urgency text default 'normal' check (urgency in ('low','normal','high','critical')),
  triggered_by text not null check (triggered_by in ('ai','keyword','user_request','sentiment','time','manual')),
  resolved boolean default false,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  notes text,
  created_at timestamptz default now()
);
create index if not exists handoffs_brand_idx on handoffs(brand_id, created_at desc);
create index if not exists handoffs_unresolved_idx on handoffs(resolved) where resolved = false;

-- -----------------------------------------------------------------------------
-- LEARNINGS — nightly insights from the learning loop
-- -----------------------------------------------------------------------------
create table if not exists learnings (
  id uuid primary key default uuid_generate_v4(),
  brand_id uuid references brands(id) on delete cascade not null,
  category text check (category in ('missed_intent','tone_correction','factual_gap','escalation_pattern','process_gap','other')),
  insight text not null,
  severity text default 'medium' check (severity in ('low','medium','high')),
  suggested_fix text,
  example_conversation_ids uuid[] default array[]::uuid[],
  status text default 'pending' check (status in ('pending','approved','rejected','applied')),
  approved_by uuid references auth.users(id),
  applied_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists learnings_brand_status_idx on learnings(brand_id, status);

-- -----------------------------------------------------------------------------
-- LEAD_EVENTS — every captured lead intent (drives funnel analytics)
-- -----------------------------------------------------------------------------
create table if not exists lead_events (
  id uuid primary key default uuid_generate_v4(),
  brand_id uuid references brands(id) on delete cascade not null,
  subscriber_id uuid references subscribers(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  event_type text not null check (event_type in ('intent_captured','link_sent','callback_requested','registered','deposited')),
  persona text,
  score int,
  utm_campaign text,
  utm_content text,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists lead_events_brand_created_idx on lead_events(brand_id, created_at desc);

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Vector similarity search, scoped to brand
create or replace function match_chunks(
  query_embedding vector(1536),
  match_brand_id uuid,
  match_threshold float default 0.5,
  match_count int default 5
) returns table (
  id uuid,
  document_id uuid,
  content text,
  metadata jsonb,
  similarity float
) language sql stable as $$
  select
    document_chunks.id,
    document_chunks.document_id,
    document_chunks.content,
    document_chunks.metadata,
    1 - (document_chunks.embedding <=> query_embedding) as similarity
  from document_chunks
  where document_chunks.brand_id = match_brand_id
    and 1 - (document_chunks.embedding <=> query_embedding) > match_threshold
  order by document_chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- Trigger to update updated_at
create or replace function tg_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists brands_updated_at on brands;
create trigger brands_updated_at before update on brands
  for each row execute function tg_set_updated_at();

drop trigger if exists subscribers_updated_at on subscribers;
create trigger subscribers_updated_at before update on subscribers
  for each row execute function tg_set_updated_at();

-- Trigger to increment conversation.message_count and update last_message_at
create or replace function tg_bump_conversation() returns trigger language plpgsql as $$
begin
  update conversations
    set message_count = message_count + 1,
        last_message_at = now()
    where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists messages_bump_conv on messages;
create trigger messages_bump_conv after insert on messages
  for each row execute function tg_bump_conversation();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table brands enable row level security;
alter table brand_memberships enable row level security;
alter table manychat_accounts enable row level security;
alter table subscribers enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table documents enable row level security;
alter table document_chunks enable row level security;
alter table handoffs enable row level security;
alter table learnings enable row level security;
alter table lead_events enable row level security;

-- Helper: is the auth user a member of this brand?
create or replace function is_brand_member(b_id uuid) returns boolean
  language sql stable security definer as $$
    select exists (
      select 1 from brand_memberships
      where brand_memberships.brand_id = b_id
        and brand_memberships.user_id = auth.uid()
    );
$$;

-- Brands: members can read; only service role writes initially
create policy "brands_read_members" on brands for select using (is_brand_member(id));
create policy "brand_memberships_read_self" on brand_memberships for select using (user_id = auth.uid());

-- All tenant tables: members of the brand can read; writes via service role
create policy "manychat_accounts_read" on manychat_accounts for select using (is_brand_member(brand_id));
create policy "subscribers_read" on subscribers for select using (is_brand_member(brand_id));
create policy "conversations_read" on conversations for select using (is_brand_member(brand_id));
create policy "messages_read" on messages for select using (is_brand_member(brand_id));
create policy "documents_read" on documents for select using (is_brand_member(brand_id));
create policy "document_chunks_read" on document_chunks for select using (is_brand_member(brand_id));
create policy "handoffs_read" on handoffs for select using (is_brand_member(brand_id));
create policy "learnings_read" on learnings for select using (is_brand_member(brand_id));
create policy "lead_events_read" on lead_events for select using (is_brand_member(brand_id));

-- Admin members can write to most tables (writes are typically server-side, but UI handoff resolution needs this)
create policy "handoffs_update_members" on handoffs for update using (is_brand_member(brand_id));
create policy "learnings_update_members" on learnings for update using (is_brand_member(brand_id));
create policy "documents_insert_members" on documents for insert with check (is_brand_member(brand_id));
create policy "documents_delete_members" on documents for delete using (is_brand_member(brand_id));

-- =============================================================================
-- SEED — default Meridian brand (edit the prompt after you read it)
-- =============================================================================
insert into brands (slug, name, system_prompt, voice_guidelines, mandatory_disclaimer, landing_base_url)
values (
  'meridian',
  'Meridian',
  $$Eres Josué Melero respondiendo DMs en tu Instagram @josue.melero. Eres el founder de Meridian, broker LATAM. Hablas en PRIMERA PERSONA siempre — eres tú, no un asistente.

## Quién eres
Trader profesional, anti-guru, anti-industria fraudulenta. Sabes que la mayoría de prop firms y brokers están diseñados para que el trader pierda (B-book). Construiste Meridian para que eso no pase. No vendes humo: enseñas el juego real.

## Tu misión en cada DM
1. **Conectar primero, vender después.** Responde la duda real de la persona ANTES de empujar nada.
2. **Calificar discretamente:** ¿es newbie / trader experimentado / candidato a Team Pro / prop firm refugee?
3. **Mover a la acción** cuando hay intent claro: enviar landing con UTMs (tool `send_landing_link`).
4. **Pasar a humano** cuando: piden hablar contigo personalmente, quieren depositar, hay queja, o no estás 100% seguro (tool `handoff_to_human`).

## Reglas de voz (NO negociables)
- Tuteas siempre. Hablas mexicano/latino, no español neutral plástico.
- Frases cortas. Máximo 3 frases por respuesta. Si necesitas más, divide o pasa a humano.
- Directo sin ser grosero. "Te están jodiendo en X, así funciona Y" > "Es una excelente pregunta, déjame explicarte".
- NUNCA usas: "absolutamente", "claro que sí", "excelente pregunta", "como modelo de IA". Eso suena a bot.
- NUNCA inventas datos. Si no sabes, dices: "déjame conectarte con alguien del equipo que te responde en serio".
- Emoji máximo 1 por mensaje, y solo si suma (🎯 ✊ 🤝). Cero corazones, cero 😊.
- NUNCA prometes rentabilidad ni das consejo financiero personalizado.
- Si te preguntan datos sensibles (cuenta, depósito, retiro, tarjeta), NUNCA los pides — handoff inmediato.

## Conocimiento técnico que manejas (del KB)
- Smart Money Concepts: order blocks, FVG, liquidity pools, "albercas de liquidez"
- Código Suizo (metodología que conoces y respetas)
- Diferencia A-book vs B-book en brokers (Meridian es A-book real)
- Prop firms: por qué la mayoría te tumban, por qué Meridian Team Pro es distinto
- Psicología del trading retail

## Cuando hablan de retornos / rentabilidad
Agregas SIEMPRE al final: el disclaimer obligatorio (te lo doy abajo).$$,
  $$Voz Josué: anti-guru con datos, directo sin ser arrogante, educa sin sermonear. Cuando alguien dice una mentira que la industria vende, la desarmas con un dato concreto. Cuando alguien está perdido, NO le das un curso — le das el siguiente paso. No usas tecnicismos innecesarios pero tampoco infantilizas. Si la persona es trader serio, suben el nivel técnico juntos. Si es newbie, traduces sin condescendencia.$$,
  'Trading conlleva riesgo de pérdida. Resultados pasados no garantizan resultados futuros. Esto no es asesoría financiera personalizada — es información educativa.',
  'https://trademeridian.co'
)
on conflict (slug) do update set
  system_prompt = excluded.system_prompt,
  voice_guidelines = excluded.voice_guidelines,
  mandatory_disclaimer = excluded.mandatory_disclaimer,
  landing_base_url = excluded.landing_base_url;

-- =============================================================================
-- STORAGE BUCKET for knowledge base files
-- Run this AFTER the migration via: select supabase_storage.create_bucket(...)
-- Or create manually in Supabase Dashboard > Storage:
--   Bucket name: kb
--   Public: NO
-- =============================================================================
