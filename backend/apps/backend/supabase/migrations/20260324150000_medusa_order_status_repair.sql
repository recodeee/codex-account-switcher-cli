-- Repair Medusa core schema drift where "order.status" is missing.
-- This is intentionally idempotent and scoped to schemas commonly used in this repo.

do $$
declare
  target_schema text;
begin
  foreach target_schema in array array['commerce', 'public']
  loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = target_schema
        and table_name = 'order'
    ) then
      execute format(
        'alter table %I."order" add column if not exists status text',
        target_schema
      );

      execute format(
        'update %I."order" set status = ''pending'' where status is null',
        target_schema
      );

      execute format(
        'alter table %I."order" alter column status set default ''pending''',
        target_schema
      );

      execute format(
        'alter table %I."order" alter column status set not null',
        target_schema
      );

      execute format(
        'create index if not exists "IDX_order_status" on %I."order" ("status") where deleted_at is null',
        target_schema
      );
    end if;
  end loop;
end
$$;
