alter table brands
  add column if not exists fallback_handoff_message text,
  add column if not exists fallback_landing_message_template text,
  add column if not exists fallback_callback_message_template text,
  add column if not exists fallback_callback_handoff_message text,
  add column if not exists dedup_variants text[];

comment on column brands.fallback_handoff_message is
  'Used when the handoff_to_human tool omits user_message_to_send. Keep it short and voice-matched.';
comment on column brands.fallback_landing_message_template is
  'Used when send_landing_link omits message. Must contain the literal {LINK} placeholder.';
comment on column brands.fallback_callback_message_template is
  'Used when schedule_callback omits message and CALLBACK_BOOKING_URL is configured. Must contain {LINK}.';
comment on column brands.fallback_callback_handoff_message is
  'Used when schedule_callback fires but CALLBACK_BOOKING_URL is not configured (converts to human handoff).';
comment on column brands.dedup_variants is
  'Suffixes appended when avoidDuplicateReply detects the model repeated its own last reply. Rotated by hash. Empty array disables suffixing.';

-- Seed default Meridian values so the current behavior is preserved after migration.
update brands
set
  fallback_handoff_message = coalesce(fallback_handoff_message,
    'Te conecto con alguien del equipo 🙌'),
  fallback_landing_message_template = coalesce(fallback_landing_message_template,
    'Aquí tienes 👉 {LINK}'),
  fallback_callback_message_template = coalesce(fallback_callback_message_template,
    'Agenda aquí y el equipo te da seguimiento: {LINK}'),
  fallback_callback_handoff_message = coalesce(fallback_callback_handoff_message,
    'Te conecto con alguien del equipo para coordinar la llamada. Te responden por aquí en breve 🤝'),
  dedup_variants = coalesce(dedup_variants, array[
    'Si no te abre, te lo vuelvo a pasar.',
    'Si te atoras en el proceso, me dices.',
    'Si quieres, te explico cuál te conviene.'
  ])
where slug = 'meridian';
