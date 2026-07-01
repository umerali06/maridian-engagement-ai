# Costs

## Per-conversation cost breakdown

Assumptions (Meridian-realistic):
- Average conversation: **6 turns** (3 user, 3 assistant)
- Each turn: ~150 tokens user, ~300 tokens assistant reply
- System prompt: ~4000 tokens, 90% cache hit
- RAG: 5 chunks × 500 tokens each = 2500 tokens injected as user-context, not cached

### Per turn (Sonnet 4.6)

| Component | Tokens | Price | Cost |
|---|---|---|---|
| System (cache hit) | 4000 × 0.10 | $0.30/1M | $0.00012 |
| RAG context | 2500 | $3/1M | $0.0075 |
| User message + history | ~1500 | $3/1M | $0.0045 |
| Assistant output | 300 | $15/1M | $0.0045 |
| **Per turn** | | | **~$0.016** |

### Per conversation: ~$0.10

### Per month at 10k conversations: ~$1000 in Claude

Wait, that's higher than the SPEC.md estimate. The SPEC was optimistic. Real numbers:

| Scale | Conversations/mo | Turns/mo | Claude cost | Total infra |
|---|---|---|---|---|
| MVP | 1,000 | 6,000 | ~$100 | ~$160/mo |
| Growth | 10,000 | 60,000 | ~$1,000 | ~$1,100/mo |
| Scale | 50,000 | 300,000 | ~$5,000 | ~$5,200/mo |

### Mitigations (in priority order)

1. **Trim RAG context**: 5 chunks → 3 chunks = -40% on RAG tokens = ~30% total savings
2. **Use Haiku 4.5 for simple turns**: classify first, route easy turns to Haiku (10x cheaper)
3. **Aggressive summarization of history**: drop verbatim history > 10 turns, replace with running summary
4. **Cache the RAG content too**: when same chunks are retrieved consecutively, ephemeral-cache them

After optimization (sensible default for Meridian):
- 10k convs/mo → ~$300/mo Claude → ~$400/mo total infra

## Other line items

| Service | Tier | Cost/mo |
|---|---|---|
| Supabase | Free → Pro at growth | $0 → $25 |
| Vercel | Hobby → Pro for Cron | $0 → $20 |
| ManyChat Pro | per account | $15 each |
| Telegram Bot | free | $0 |
| OpenAI embeddings | per usage | ~$2 at 10k convs |

## Where to watch costs

### Dashboard estimate

`/dashboard` shows a 7-day Claude estimate from stored `messages` token fields. It uses the same rough formula as the SQL below:

```text
((tokens_input - tokens_cache_read) × 3.00
 + tokens_cache_read × 0.30
 + tokens_output × 15.00) / 1,000,000
```

This is an operational estimate, not the billing source of truth. Anthropic billing remains authoritative, and the dashboard only includes messages where token usage was persisted.

### Anthropic
- https://console.anthropic.com/settings/billing — daily usage chart
- Set a **spend limit** under Settings → Limits

### OpenAI
- https://platform.openai.com/usage
- Embeddings only ~$0.02 / 1M tokens — negligible.

### Supabase
- Project Dashboard → Billing & Usage. Watch:
  - Database size (chunks are heavy)
  - Egress (large dashboard queries)
  - Realtime connections (we don't use Realtime)

### Vercel
- Project → Usage. Watch:
  - Function execution time (KB ingestion can be long)
  - Bandwidth (low for API-only traffic)

## Per-brand cost attribution (when you onboard more)

Query in Supabase:

```sql
select
  brands.name,
  count(distinct conversations.id) as convos,
  sum(messages.tokens_input) as in_tokens,
  sum(messages.tokens_output) as out_tokens,
  sum(messages.tokens_cache_read) as cache_read,
  -- rough cost in USD assuming Sonnet 4.6 pricing
  round(
    (sum(messages.tokens_input - coalesce(messages.tokens_cache_read,0)) * 3.0
     + sum(coalesce(messages.tokens_cache_read,0)) * 0.30
     + sum(messages.tokens_output) * 15.0
    ) / 1000000.0,
    2
  ) as claude_cost_usd
from messages
join conversations on conversations.id = messages.conversation_id
join brands on brands.id = messages.brand_id
where messages.created_at > now() - interval '30 days'
group by brands.name
order by claude_cost_usd desc;
```

Bill it back to clients monthly.

## Alarms to set

- Anthropic spend limit: 2× expected monthly (kill switch)
- Supabase DB size > 80% of plan limit
- Vercel function timeout rate > 1%
- Pending handoffs > 20 (means humans aren't responding)
