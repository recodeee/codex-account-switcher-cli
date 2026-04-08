import {
  DEFAULT_MEDUSA_DB_SCHEMA,
  getConfiguredMedusaDbSchema,
  qualifyPgTable,
  resolveMedusaDbSchema,
  withDbSchemaSearchPath,
} from "./database-schema"

describe("database-schema helpers", () => {
  it("uses DB_SCHEMA when it is set", () => {
    expect(
      getConfiguredMedusaDbSchema({ DB_SCHEMA: "szalonirda" } as NodeJS.ProcessEnv)
    ).toBe("szalonirda")
  })

  it("falls back to MEDUSA_DB_SCHEMA when DB_SCHEMA is missing", () => {
    expect(
      getConfiguredMedusaDbSchema({
        MEDUSA_DB_SCHEMA: "szalonirda",
      } as NodeJS.ProcessEnv)
    ).toBe("szalonirda")
  })

  it("ignores invalid schema names", () => {
    expect(
      getConfiguredMedusaDbSchema({
        DB_SCHEMA: "bad schema",
        MEDUSA_DB_SCHEMA: "still bad",
      } as NodeJS.ProcessEnv)
    ).toBeUndefined()
  })

  it("falls back to the default schema when no configured schema exists", () => {
    expect(resolveMedusaDbSchema({} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_MEDUSA_DB_SCHEMA
    )
  })

  it("adds search_path using the configured schema", () => {
    expect(
      withDbSchemaSearchPath("postgresql://user:pass@db.example/postgres", {
        DB_SCHEMA: "szalonirda",
      } as NodeJS.ProcessEnv)
    ).toContain("options=-c+search_path%3Dszalonirda")
  })

  it("qualifies table names with the schema", () => {
    expect(qualifyPgTable("szalonirda", "subscription_account")).toBe(
      '"szalonirda"."subscription_account"'
    )
  })
})
