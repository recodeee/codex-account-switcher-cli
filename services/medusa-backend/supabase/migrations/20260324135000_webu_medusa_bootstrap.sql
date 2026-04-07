-- WEBU + Medusa bootstrap (safe for existing Medusa DB)
-- This migration creates WEBU-owned objects only.
-- It does not alter core Medusa tables.

create schema if not exists webu;

create extension if not exists pgcrypto;

create or replace function webu.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists webu.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_webu_settings_updated_at on webu.settings;

create trigger trg_webu_settings_updated_at
before update on webu.settings
for each row
execute function webu.touch_updated_at();

create table if not exists webu.seed_history (
  id uuid primary key default gen_random_uuid(),
  seed_name text not null unique,
  applied_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_webu_seed_history_applied_at
  on webu.seed_history (applied_at desc);
