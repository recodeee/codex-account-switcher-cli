-- Initial commerce seed data for Medusa-linked environment
-- Idempotent inserts only.

insert into commerce.settings (key, value, description)
values
  (
    'project.runtime',
    jsonb_build_object(
      'provider', 'local',
      'mode', 'medusa',
      'updated_by', 'migration:20260324135100'
    ),
    'Runtime defaults for project preview and editor orchestration.'
  ),
  (
    'project.features',
    jsonb_build_object(
      'supabase_workspace', true,
      'medusa_shared_db', true
    ),
    'Feature flags related to Supabase + Medusa integration.'
  )
on conflict (key) do update
set
  value = excluded.value,
  description = excluded.description,
  updated_at = now();

insert into commerce.seed_history (seed_name, metadata)
values (
  '20260324135100_commerce_medusa_seed',
  jsonb_build_object(
    'status', 'applied',
    'source', 'supabase/migrations/20260324135100_commerce_medusa_seed.sql'
  )
)
on conflict (seed_name) do nothing;
