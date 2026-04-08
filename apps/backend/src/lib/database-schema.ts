const DEFAULT_MEDUSA_DB_SCHEMA = "commerce"
const POSTGRES_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/

export function getConfiguredMedusaDbSchema(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const configuredSchema =
    env.DB_SCHEMA?.trim() || env.MEDUSA_DB_SCHEMA?.trim() || undefined

  if (!configuredSchema) {
    return undefined
  }

  return POSTGRES_IDENTIFIER_PATTERN.test(configuredSchema)
    ? configuredSchema
    : undefined
}

export function resolveMedusaDbSchema(
  env: NodeJS.ProcessEnv = process.env
): string {
  return getConfiguredMedusaDbSchema(env) ?? DEFAULT_MEDUSA_DB_SCHEMA
}

export function quotePgIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

export function qualifyPgTable(
  schema: string,
  tableName: string
): string {
  return `${quotePgIdentifier(schema)}.${quotePgIdentifier(tableName)}`
}

export function withDbSchemaSearchPath(
  baseDatabaseUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const configuredSchema = getConfiguredMedusaDbSchema(env)
  if (!baseDatabaseUrl || !configuredSchema) {
    return baseDatabaseUrl
  }

  try {
    const parsed = new URL(baseDatabaseUrl)
    const existingOptions = parsed.searchParams.get("options")

    if (existingOptions?.includes("search_path")) {
      return parsed.toString()
    }

    const schemaOption = `-c search_path=${configuredSchema}`
    parsed.searchParams.set(
      "options",
      existingOptions ? `${existingOptions} ${schemaOption}` : schemaOption
    )

    return parsed.toString()
  } catch {
    return baseDatabaseUrl
  }
}

export { DEFAULT_MEDUSA_DB_SCHEMA }
