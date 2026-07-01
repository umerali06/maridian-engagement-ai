# Data Retention Policy

This document describes recommended retention windows for tables that accumulate over time. It is a policy guideline — actual pruning is not automated except where noted.

## Automated

| Table | Retention | Mechanism |
|-------|-----------|-----------|
| `webhook_dedup` | 24 hours | `/api/cron/dedup-cleanup` daily at 05:00 UTC |

## Manual / not yet automated

| Table | Recommended retention | Notes |
|-------|-----------------------|-------|
| `messages` | 12 months full detail; archive older to cold storage | Contains user content; subject to data-subject deletion requests |
| `conversations` | 12 months full detail; keep summary + sentiment beyond | Referenced by learnings and lead events |
| `lead_events` | 90 days full detail; 12 months aggregated; delete older | Analytics use only |
| `short_link_nonces` | 30 days | Nonces are single-use; unclicked rows can be pruned faster |
| `handoff_alerts` | 30 days | Only used for rate-limiting alerts |
| `handoffs` | 12 months | Business record of human takeovers |
| `learnings` | Indefinite while `status = 'applied'`; 90 days for `pending` / `rejected` | Applied learnings feed prompt caching |
| `documents`, `chunks`, `embeddings` | Indefinite; delete when brand deletes source doc | Cascades via FK |

## Data-subject deletion

If a subscriber requests deletion under GDPR / CCPA:

1. Locate the row in `subscribers` by `manychat_subscriber_id` or `email`.
2. `delete from subscribers where id = '<uuid>';` — cascade removes `conversations`, `messages`, `lead_events`, `handoffs`, `short_link_nonces`, `handoff_alerts`.
3. Confirm the delete in ManyChat as well by removing the subscriber from the account.

## Future work

A monthly retention cron should be built to enforce the recommended windows automatically. Suggested schedule:

- `/api/cron/retention-monthly` at `0 6 1 * *` (first day of each month, 06:00 UTC)
- Iterates each table above and applies the retention window
- Gated by `CRON_SECRET`
