import { Migration } from "@medusajs/framework/mikro-orm/migrations";
import {
  qualifyPgTable,
  quotePgIdentifier,
  resolveMedusaDbSchema,
} from "../../../lib/database-schema";

export class Migration20260408122749 extends Migration {

  override async up(): Promise<void> {
    const schema = resolveMedusaDbSchema()
    const qualifiedSubscriptionAccount = qualifyPgTable(schema, "subscription_account")
    const qualifiedSubscriptionSeat = qualifyPgTable(schema, "subscription_seat")
    const quotedSchema = quotePgIdentifier(schema)

    this.addSql(`create schema if not exists ${quotedSchema};`);

    this.addSql(`create table if not exists ${qualifiedSubscriptionAccount} ("id" text not null, "domain" text not null, "plan_code" text not null, "plan_name" text not null, "subscription_status" text check ("subscription_status" in ('trialing', 'active', 'past_due', 'canceled', 'expired')) not null, "entitled" boolean not null default false, "payment_status" text check ("payment_status" in ('paid', 'requires_action', 'past_due', 'unpaid')) not null, "billing_cycle_start" timestamptz not null, "billing_cycle_end" timestamptz not null, "renewal_at" timestamptz null, "chatgpt_seats_in_use" integer not null default 0, "codex_seats_in_use" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "subscription_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subscription_account_deleted_at" ON ${qualifiedSubscriptionAccount} ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists ${qualifiedSubscriptionSeat} ("id" text not null, "member_name" text not null, "member_email" text not null, "role" text not null, "seat_type" text check ("seat_type" in ('ChatGPT', 'Codex')) not null, "date_added" timestamptz not null, "account_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "subscription_seat_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subscription_seat_account_id" ON ${qualifiedSubscriptionSeat} ("account_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subscription_seat_deleted_at" ON ${qualifiedSubscriptionSeat} ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists ${qualifiedSubscriptionSeat} add constraint "subscription_seat_account_id_foreign" foreign key ("account_id") references ${qualifiedSubscriptionAccount} ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    const schema = resolveMedusaDbSchema()
    const qualifiedSubscriptionAccount = qualifyPgTable(schema, "subscription_account")
    const qualifiedSubscriptionSeat = qualifyPgTable(schema, "subscription_seat")
    const quotedSchema = quotePgIdentifier(schema)

    this.addSql(`alter table if exists ${qualifiedSubscriptionSeat} drop constraint if exists "subscription_seat_account_id_foreign";`);

    this.addSql(`drop table if exists ${qualifiedSubscriptionAccount} cascade;`);

    this.addSql(`drop table if exists ${qualifiedSubscriptionSeat} cascade;`);

    this.addSql(`drop schema if exists ${quotedSchema};`);
  }

}
