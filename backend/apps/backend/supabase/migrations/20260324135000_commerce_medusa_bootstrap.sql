-- Commerce + Medusa bootstrap (safe for existing Medusa DB)
-- This migration creates commerce-layer owned objects only.
-- It does not alter core Medusa tables.

create schema if not exists commerce;

create extension if not exists pgcrypto;

create or replace function commerce.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists commerce.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_commerce_settings_updated_at on commerce.settings;

create trigger trg_commerce_settings_updated_at
before update on commerce.settings
for each row
execute function commerce.touch_updated_at();

create table if not exists commerce.seed_history (
  id uuid primary key default gen_random_uuid(),
  seed_name text not null unique,
  applied_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_commerce_seed_history_applied_at
  on commerce.seed_history (applied_at desc);
