import { Migration20260408122749 } from "./Migration20260408122749"

describe("Migration20260408122749", () => {
  const originalDbSchema = process.env.DB_SCHEMA
  const originalMedusaDbSchema = process.env.MEDUSA_DB_SCHEMA

  afterEach(() => {
    if (originalDbSchema === undefined) {
      delete process.env.DB_SCHEMA
    } else {
      process.env.DB_SCHEMA = originalDbSchema
    }

    if (originalMedusaDbSchema === undefined) {
      delete process.env.MEDUSA_DB_SCHEMA
    } else {
      process.env.MEDUSA_DB_SCHEMA = originalMedusaDbSchema
    }
  })

  it("targets the configured schema for subscription tables and indexes", async () => {
    process.env.DB_SCHEMA = "szalonirda"
    delete process.env.MEDUSA_DB_SCHEMA

    const migration = new Migration20260408122749(undefined as never, undefined as never)
    await migration.up()

    expect(migration.getQueries()).toEqual(
      expect.arrayContaining([
        'create schema if not exists "szalonirda";',
        expect.stringContaining(
          'create table if not exists "szalonirda"."subscription_account"'
        ),
        expect.stringContaining(
          'CREATE INDEX IF NOT EXISTS "IDX_subscription_account_deleted_at" ON "szalonirda"."subscription_account"'
        ),
        expect.stringContaining(
          'create table if not exists "szalonirda"."subscription_seat"'
        ),
        expect.stringContaining(
          'CREATE INDEX IF NOT EXISTS "IDX_subscription_seat_account_id" ON "szalonirda"."subscription_seat"'
        ),
        expect.stringContaining(
          'references "szalonirda"."subscription_account" ("id")'
        ),
      ])
    )
  })

  it("falls back to the default schema when no env override exists", async () => {
    delete process.env.DB_SCHEMA
    delete process.env.MEDUSA_DB_SCHEMA

    const migration = new Migration20260408122749(undefined as never, undefined as never)
    await migration.up()

    expect(migration.getQueries()).toEqual(
      expect.arrayContaining([
        'create schema if not exists "commerce";',
        expect.stringContaining(
          'create table if not exists "commerce"."subscription_account"'
        ),
      ])
    )
  })
})
